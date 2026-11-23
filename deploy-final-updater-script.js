const { execBash } = require('./remote-exec');

async function main() {
  const masterScript = `#!/bin/bash
# ==============================================================================
# Systego Production Multi-Tenant Updater & Sync Engine (v2 - Self-Contained)
# Usage:
#   ./update-systego.sh sync <tenant_name>   # Syncs one tenant
#   ./update-systego.sh sync all             # Syncs all active tenants in parallel
#   ./update-systego.sh check                # Health check all tenants
# ==============================================================================
set -e

BASE_DIR="/var/www/vhosts/systego.net"
SUBDOMAINS="$BASE_DIR/subdomains"
SOURCE_FE="$SUBDOMAINS/janssen"
EXCLUDED="joox-eg bcknd default tmp"

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/psa/bin:/usr/local/psa/sbin"

# Safety: Always remove rogue monorepo lockfile if created
rm -f "$BASE_DIR/package-lock.json" "$BASE_DIR/package.json"

is_excluded() {
    local name="$1"
    for ex in $EXCLUDED; do
        if [ "$name" = "$ex" ]; then
            return 0
        fi
    done
    return 1
}

sync_tenant() {
    local t="$1"
    local dest="$SUBDOMAINS/$t"

    if is_excluded "$t"; then
        echo "[SKIP] Tenant '$t' is protected and excluded from auto-sync."
        return 0
    fi

    if [ ! -d "$dest" ]; then
        echo "[ERROR] Tenant directory does not exist: $dest"
        return 1
    fi

    echo "==> [START] Syncing tenant: $t"
    
    # 1. Sync compiled assets and dependencies from reference
    rsync -a --delete "$SOURCE_FE/node_modules/" "$dest/node_modules/"
    rsync -a --delete "$SOURCE_FE/.next/" "$dest/.next/"
    cp -f "$SOURCE_FE/server.js" "$dest/server.js"
    rm -rf "$dest/node_modules.update-backup" 2>/dev/null || true

    # 2. Re-wire tenant-specific URLs and paths inside compiled .next
    echo "    -> Personalizing .next bundle for $t..."
    find "$dest/.next" -type f \\( -name "*.js" -o -name "*.json" \\) -exec sed -i "s|https://api-janssen.systego.net|https://api-$t.systego.net|g" {} +
    find "$dest/.next" -type f \\( -name "*.js" -o -name "*.json" \\) -exec sed -i "s|https://bcknd.systego.net|https://api-$t.systego.net|g" {} +
    find "$dest/.next" -type f \\( -name "*.js" -o -name "*.json" \\) -exec sed -i "s|/subdomains/janssen|/subdomains/$t|g" {} +
    find "$dest/.next" -type f \\( -name "*.js" -o -name "*.json" \\) -exec sed -i "s|/httpdocs|/subdomains/$t|g" {} +

    # 3. Clear Next.js internal turbopack/SSR cache
    rm -rf "$dest/.next/cache"

    # 4. Permissions & Passenger reload
    chown -R systego:psacln "$dest"
    mkdir -p "$dest/tmp"
    chmod 777 "$dest/tmp"
    touch "$dest/tmp/restart.txt"
    chmod 666 "$dest/tmp/restart.txt"

    /usr/sbin/plesk ext nodejs --restart -domain "\${t}.systego.net" 2>/dev/null || true
    echo "==> [SUCCESS] Fully updated and personalized: $t"
}

check_all() {
    echo "================================================================"
    echo "             SYSTEGO TENANTS LIVE HEALTH CHECK"
    echo "================================================================"
    for d in "$SUBDOMAINS"/*; do
        if [ -d "$d" ]; then
            t=$(basename "$d")
            case "$t" in
                api-*|tmp|"*"|*.bak) continue ;;
            esac
            status_fe=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "https://\${t}.systego.net/" 2>/dev/null || echo "TIMEOUT")
            status_admin=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "https://\${t}.systego.net/admin-login/" 2>/dev/null || echo "TIMEOUT")
            status_pos=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "https://\${t}.systego.net/point-of-sale/" 2>/dev/null || echo "TIMEOUT")
            echo "Tenant: \${t} => Web: \${status_fe} | Admin: \${status_admin} | POS: \${status_pos}"
        fi
    done
    echo "================================================================"
}

ACTION="$1"
TARGET="$2"

case "$ACTION" in
    sync)
        if [ "$TARGET" = "all" ]; then
            echo "Starting parallel sync for all eligible tenants..."
            for d in "$SUBDOMAINS"/*; do
                if [ -d "$d" ]; then
                    t=$(basename "$d")
                    case "$t" in
                        api-*|tmp|"*"|*.bak) continue ;;
                    esac
                    if ! is_excluded "$t"; then
                        sync_tenant "$t" &
                    fi
                fi
            done
            wait
            echo "All eligible tenants synced and personalized successfully!"
        elif [ -n "$TARGET" ]; then
            sync_tenant "$TARGET"
        else
            echo "Usage: $0 sync <tenant_name|all>"
            exit 1
        fi
        ;;
    check)
        check_all
        ;;
    *)
        echo "Usage: $0 {sync <tenant|all> | check}"
        exit 1
        ;;
esac
`;

  console.log("Deploying master updater script to server...");
  const cmd = `
cat << 'EOF' > /var/www/vhosts/systego.net/scripts/update-systego.sh
${masterScript}
EOF
chmod +x /var/www/vhosts/systego.net/scripts/update-systego.sh
chown systego:psacln /var/www/vhosts/systego.net/scripts/update-systego.sh
echo "DEPLOY_OK"
`;

  const out = await execBash(cmd);
  console.log(out);
}

main().catch(console.error);
