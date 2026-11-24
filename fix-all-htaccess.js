const { execBash } = require('./remote-exec');

async function main() {
    const cmd = `
python3 -c "
import os, shutil

vhosts = '/var/www/vhosts/systego.net/subdomains'
janssen_admin = os.path.join(vhosts, 'janssen/admin-login/.htaccess')
janssen_pos = os.path.join(vhosts, 'janssen/point-of-sale/.htaccess')
ignore = {'bcknd', 'default', 'httpdocs', 'webmail', 'cgi-bin', 'error_docs', 'joox-eg', 'janssen'}

for d in os.listdir(vhosts):
    if d.startswith('api-') or d in ignore:
        continue
    admin_dir = os.path.join(vhosts, d, 'admin-login')
    if os.path.isdir(admin_dir):
        shutil.copyfile(janssen_admin, os.path.join(admin_dir, '.htaccess'))
        print(f'Updated admin-login/.htaccess for {d}')
    pos_dir = os.path.join(vhosts, d, 'point-of-sale')
    if os.path.isdir(pos_dir):
        shutil.copyfile(janssen_pos, os.path.join(pos_dir, '.htaccess'))
        print(f'Updated point-of-sale/.htaccess for {d}')

os.system('chown -R systego:psacln /var/www/vhosts/systego.net/subdomains/*/*/.htaccess 2>/dev/null')
print('DONE!')
"
`;
    const out = await execBash(cmd);
    console.log(out);
}

main().catch(console.error);
