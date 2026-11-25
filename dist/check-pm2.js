"use strict";
const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });
const API_KEY = '698f334b-53b1-69fd-612f-bd9c30d9222c';
async function runBash(cmd) {
    const b64 = Buffer.from(cmd).toString('base64');
    const runnerCmd = `echo "${b64}" | base64 -d > /tmp/runner.sh && bash /tmp/runner.sh > /var/www/vhosts/systego.net/subdomains/joox-eg/point-of-sale/dist/_agy_out.txt 2>&1`;
    const createRes = await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
        params: ['-c', '-type', 'exec', '-user', 'root', '-command', runnerCmd, '-schedule', '0 0 1 1 *', '-notify', 'ignore', '-json']
    }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent });
    const taskId = JSON.parse(createRes.data.stdout).id;
    try {
        await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
            params: ['-r', String(taskId)]
        }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent });
        const res = await axios.get('https://joox-eg.systego.net/point-of-sale/_agy_out.txt?t=' + Date.now(), { httpsAgent: agent });
        return res.data;
    }
    finally {
        await axios.post('https://superback.systego.net:8443/api/v2/cli/scheduler/call', {
            params: ['-d', String(taskId)]
        }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }, httpsAgent: agent });
    }
}
async function main() {
    const cmd = process.argv.slice(2).join(' ') || 'whoami';
    const out = await runBash(cmd);
    console.log(out);
}
main().catch(console.error);
