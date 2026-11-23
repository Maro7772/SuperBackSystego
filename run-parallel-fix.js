const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });
const API_KEY = '698f334b-53b1-69fd-612f-bd9c30d9222c';

async function main() {
  const shortCmd = `bash -c 'for t in beonhelmet company dior elrayan samarstore sherbiny tulin; do (d=/var/www/vhosts/systego.net/subdomains/$t; rsync -a --delete /var/www/vhosts/systego.net/subdomains/janssen/node_modules/ $d/node_modules/; rsync -a --delete /var/www/vhosts/systego.net/subdomains/janssen/.next/ $d/.next/; cp -f /var/www/vhosts/systego.net/subdomains/janssen/server.js $d/server.js; chown -R systego:psacln $d; mkdir -p $d/tmp; touch $d/tmp/restart.txt; /usr/sbin/plesk ext nodejs --restart -domain $t.systego.net) & done; wait'`;

  console.log("Command length:", shortCmd.length);
  console.log("Submitting task to Plesk scheduler...");
  const createRes = await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
    params: ['-c', '-type', 'exec', '-user', 'root', '-command', shortCmd, '-schedule', '0 0 1 1 *', '-notify', 'ignore', '-json']
  }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent });

  console.log("createRes.data:", createRes.data);
  const taskId = JSON.parse(createRes.data.stdout).id;
  console.log("Running task ID:", taskId);

  try {
    const runRes = await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
      params: ['-r', String(taskId)]
    }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent, timeout: 300000 });
    console.log("Task finished:", runRes.data);
  } finally {
    await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
      params: ['-d', String(taskId)]
    }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent });
    console.log("Task cleaned up.");
  }
}

main().catch(console.error);
