const { execBash } = require('./remote-exec');

async function main() {
  const script = `
for t in alexmuscle beonhelmet company dior elrayan samarstore sherbiny tulin; do
  if [ -f "/var/www/vhosts/systego.net/subdomains/$t/.next/server/preview-props.json" ]; then
    echo "$t -> .next is OK"
  else
    echo "$t -> .next is BROKEN / INCOMPLETE"
  fi
done
`;
  const out = await execBash(script);
  console.log(out);
}
main().catch(console.error);
