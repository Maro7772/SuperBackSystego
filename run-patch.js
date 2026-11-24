const fs = require('fs');
const path = require('path');
const { execBash } = require('./remote-exec');

async function run() {
    const pyScript = fs.readFileSync(path.join(__dirname, 'apply-patch.py'), 'utf8');
    const pyB64 = Buffer.from(pyScript, 'utf8').toString('base64');

    console.log('Sending patch script to server (' + pyB64.length + ' base64 chars)...');

    const bashCmd = `echo "${pyB64}" | base64 -d > /tmp/patch.py && python3 /tmp/patch.py && rm -f /tmp/patch.py`;
    const out = await execBash(bashCmd);
    console.log('Server output:\n', out);
}

run().catch(err => {
    console.error('Error running patch:', err);
    process.exit(1);
});
