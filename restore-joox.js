const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });
const API_KEY = '698f334b-53b1-69fd-612f-bd9c30d9222c';

async function main() {
  const scriptContent = `#!/bin/bash
cp -f /var/www/vhosts/system/joox-eg.systego.net/conf/vhost_nginx.conf.bak /var/www/vhosts/system/joox-eg.systego.net/conf/vhost_nginx.conf
/usr/sbin/nginx -t && systemctl reload nginx
cd /var/www/vhosts/systego.net/subdomains/joox-eg
pm2 delete joox-eg 2>/dev/null || true
pm2 start npm --name joox-eg -- start -- -p 3010
pm2 save
`;

  const b64 = Buffer.from(scriptContent).toString('base64');
  const runnerCmd = `echo "${b64}" | base64 -d > /tmp/restore_joox.sh && bash /tmp/restore_joox.sh > /tmp/restore_joox.log 2>&1`;

  const createRes = await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
    params: ['-c', '-type', 'exec', '-user', 'root', '-command', runnerCmd, '-schedule', '0 0 1 1 *', '-notify', 'ignore', '-json']
  }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent });

  const taskId = JSON.parse(createRes.data.stdout).id;
  console.log('Task created ID:', taskId);

  try {
    const runRes = await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
      params: ['-r', String(taskId)]
    }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent });
    console.log('Run result:', runRes.data);
  } finally {
    await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
      params: ['-d', String(taskId)]
    }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent });
    console.log('Task cleaned up.');
  }
}

main().catch(console.error);
