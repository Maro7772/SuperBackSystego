"use strict";
const { execBash } = require('./remote-exec');
async function main() {
    const cmd = `
    export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/psa/bin:/usr/local/psa/sbin"
    cp -f /var/www/vhosts/system/joox-eg.systego.net/conf/vhost_nginx.conf /var/www/vhosts/system/joox-eg.systego.net/conf/vhost_nginx.conf.bak 2>/dev/null || true
    echo "" > /var/www/vhosts/system/joox-eg.systego.net/conf/vhost_nginx.conf
    nginx -t
    plesk srvmng --reconfigure-vhost --vhost-name=joox-eg.systego.net
    systemctl reload nginx
    touch /var/www/vhosts/systego.net/subdomains/joox-eg/tmp/restart.txt
    plesk ext nodejs --restart -domain joox-eg.systego.net
  `;
    const out = await execBash(cmd);
    console.log('RECONFIGURE RESULT:\n', out);
}
main().catch(console.error);
