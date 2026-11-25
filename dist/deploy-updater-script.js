"use strict";
const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });
const API_KEY = '698f334b-53b1-69fd-612f-bd9c30d9222c';
async function runCmd(cmd) {
    const createRes = await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
        params: ['-c', '-type', 'exec', '-user', 'root', '-command', cmd, '-schedule', '0 0 1 1 *', '-notify', 'ignore', '-json']
    }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent });
    const taskId = JSON.parse(createRes.data.stdout).id;
    try {
        const runRes = await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
            params: ['-r', String(taskId)]
        }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent });
        return runRes.data;
    }
    finally {
        await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
            params: ['-d', String(taskId)]
        }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent });
    }
}
async function main() {
    const masterScript = `#!/bin/bash
# ==============================================================================
# Systego Production Multi-Tenant Updater & Sync Engine
# Usage:
#   ./update-systego.sh sync <tenant_name>   # Syncs one tenant
#   ./update-systego.sh sync all             # Syncs all active tenants in parallel
#   ./update-systego.sh check                # Health check all tenants
# ==============================================================================
set -e

BASE_DIR="/var/www/vhosts/systego.net"
SUBDOMAINS="$BASE_DIR/subdomains"
SOURCE_FE="$SUBDOMAINS/janssen"

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/psa/bin:/usr/local/psa/sbin"

rm -f "$BASE_DIR/package-lock.json" "$BASE_DIR/package.json"

sync_tenant() {
    local t="$1"
    local dest="$SUBDOMAINS/$t"

    if [ ! -d "$dest" ]; then
        echo "[ERROR] Tenant directory does not exist: $dest"
        return 1
    fi

    echo "==> Syncing tenant: $t"
    rsync -a --delete "$SOURCE_FE/node_modules/" "$dest/node_modules/"
    rsync -a --delete "$SOURCE_FE/.next/" "$dest/.next/"
    cp -f "$SOURCE_FE/server.js" "$dest/server.js"
    rm -rf "$dest/node_modules.update-backup" 2>/dev/null || true
    chown -R systego:psacln "$dest"
    mkdir -p "$dest/tmp"
    chmod 777 "$dest/tmp"
    touch "$dest/tmp/restart.txt"
    chmod 666 "$dest/tmp/restart.txt"
    /usr/sbin/plesk ext nodejs --restart -domain "\${t}.systego.net" 2>/dev/null || true
    echo "==> [OK] Successfully updated $t"
}

check_all() {
    echo "================================================================"
    echo "             SYSTEGO TENANTS HEALTH CHECK"
    echo "================================================================"
    for d in "$SUBDOMAINS"/*; do
        if [ -d "$d" ]; then
            t=$(basename "$d")
            case "$t" in
                api-*|tmp|"*"|*.bak) continue ;;
            esac
            status=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "https://\${t}.systego.net/" 2>/dev/null || echo "TIMEOUT")
            echo "Tenant: $t => HTTP $status"
        fi
    done
    echo "================================================================"
}

ACTION="$1"
TARGET="$2"

case "$ACTION" in
    sync)
        if [ "$TARGET" = "all" ]; then
            echo "Starting parallel sync for all tenants..."
            for d in "$SUBDOMAINS"/*; do
                if [ -d "$d" ]; then
                    t=$(basename "$d")
                    case "$t" in
                        api-*|tmp|"*"|*.bak) continue ;;
                    esac
                    sync_tenant "$t" &
                fi
            done
            wait
            echo "All tenants synced successfully!"
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
    const b64 = Buffer.from(masterScript).toString('base64');
    const chunks = b64.match(/.{1,400}/g);
    console.log("Preparing chunks, total chunks:", chunks.length);
    await runCmd('mkdir -p /var/www/vhosts/systego.net/scripts && rm -f /tmp/update_script.b64');
    for (let i = 0; i < chunks.length; i++) {
        await runCmd(`echo -n "${chunks[i]}" >> /tmp/update_script.b64`);
    }
    await runCmd('base64 -d /tmp/update_script.b64 > /var/www/vhosts/systego.net/scripts/update-systego.sh && chmod +x /var/www/vhosts/systego.net/scripts/update-systego.sh && rm -f /tmp/update_script.b64');
    console.log("Script successfully installed to /var/www/vhosts/systego.net/scripts/update-systego.sh!");
}
main().catch(console.error);
