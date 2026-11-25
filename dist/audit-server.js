"use strict";
const { execBash } = require('./remote-exec');
async function main() {
    const bashScript = `
    cd /var/www/vhosts/systego.net/subdomains
    for dir in *; do
      case "$dir" in
        api-*|tmp|"*"|*.bak) continue ;;
      esac
      if [ -d "$dir" ]; then
        node_status=$(/usr/sbin/plesk ext nodejs --info -domain "\${dir}.systego.net" 2>/dev/null | grep 'Node.js:' || echo 'Node.js: disabled')
        has_server_js="no"
        has_dot_next="no"
        [ -f "$dir/server.js" ] && has_server_js="yes"
        [ -d "$dir/.next" ] && has_dot_next="yes"
        echo "FE: $dir | $node_status | server.js: $has_server_js | .next: $has_dot_next"
      fi
    done
  `;
    const out = await execBash(bashScript);
    console.log(out);
}
main().catch(console.error);
