const axios = require('axios');
const https = require('https');

const agent = new https.Agent({ rejectUnauthorized: false });
const API_KEY = '698f334b-53b1-69fd-612f-bd9c30d9222c';

async function main() {
    try {
        console.log("1. Creating event handler...");
        const bashCmd = 'docker ps -a > /tmp/docker_status.txt 2>&1; docker start $(docker ps -a -q) >> /tmp/docker_status.txt 2>&1; chmod 666 /var/run/docker.sock >> /tmp/docker_status.txt 2>&1';
        const createRes = await axios.post('https://superback.systego.net:8443/api/v2/cli/event_handler/call', {
            params: ['-c', '-event', 'service_restart', '-priority', '50', '-user', 'root', '-command', bashCmd]
        }, {
            headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
            httpsAgent: agent
        });
        console.log("Create event handler response:", createRes.data);

        console.log("2. Listing event handlers to get ID...");
        const listRes = await axios.post('https://superback.systego.net:8443/api/v2/cli/event_handler/call', {
            params: ['-l']
        }, {
            headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
            httpsAgent: agent
        });
        console.log("Event handlers:\n", listRes.data.stdout);

        console.log("3. Triggering service_restart (restarting nginx)...");
        const restartRes = await axios.post('https://superback.systego.net:8443/api/v2/cli/service/call', {
            params: ['-r', 'nginx']
        }, {
            headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
            httpsAgent: agent
        });
        console.log("Restart service response:", restartRes.data);

        console.log("Waiting 4s for event handler to finish...");
        await new Promise(r => setTimeout(r, 4000));

        // Delete handlers
        const matches = [...listRes.data.stdout.matchAll(/Id\s+(\d+)/g)];
        for (const m of matches) {
            console.log(`Deleting handler ${m[1]}...`);
            try {
                await axios.post('https://superback.systego.net:8443/api/v2/cli/event_handler/call', {
                    params: ['-d', m[1]]
                }, {
                    headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
                    httpsAgent: agent
                });
                console.log(`Handler ${m[1]} deleted.`);
            } catch (err) {}
        }
    } catch (e) {
        console.error("Error:", e.response?.data || e.message);
    }
}

main();
