"use strict";
const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });
const API_KEY = '698f334b-53b1-69fd-612f-bd9c30d9222c';
async function runCliCmd(cmd) {
    const createRes = await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
        params: ['-c', '-type', 'exec', '-user', 'root', '-command', cmd, '-schedule', '0 0 1 1 *', '-notify', 'ignore', '-json']
    }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent });
    const taskId = JSON.parse(createRes.data.stdout).id;
    try {
        await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
            params: ['-r', String(taskId)]
        }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent });
    }
    finally {
        await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
            params: ['-d', String(taskId)]
        }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent });
    }
}
async function execBash(cmd) {
    const b64 = Buffer.from(cmd).toString('base64');
    const chunks = b64.match(/.{1,350}/g) || [];
    await runCliCmd('rm -f /tmp/_agy_run.b64 /tmp/_agy_run.sh');
    for (const chunk of chunks) {
        await runCliCmd(`echo -n "${chunk}" >> /tmp/_agy_run.b64`);
    }
    const runCmd = `base64 -d /tmp/_agy_run.b64 > /tmp/_agy_run.sh && bash /tmp/_agy_run.sh > /var/www/vhosts/systego.net/subdomains/joox-eg/point-of-sale/dist/_agy_out.txt 2>&1`;
    await runCliCmd(runCmd);
    const res = await axios.get('https://joox-eg.systego.net/point-of-sale/_agy_out.txt?t=' + Date.now(), { httpsAgent: agent });
    return res.data;
}
module.exports = { execBash };
if (require.main === module) {
    const cmd = process.argv.slice(2).join(' ') || 'whoami';
    execBash(cmd)
        .then(out => console.log(out))
        .catch(e => console.error(e.response ? e.response.data : e.message));
}
