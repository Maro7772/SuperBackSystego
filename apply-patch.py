#!/usr/bin/env python3
import re
import subprocess
import os

print("=== Starting Patch for updater.systego.net ===")

# 1. Patch subdomain.service.ts
subdomain_path = "/var/www/vhosts/systego.net/updater.systego.net/src/subdomain/subdomain.service.ts"
with open(subdomain_path, "r", encoding="utf-8") as f:
    sub_code = f.read()

# Add 'all' check in validateClientName
if "if (sanitized === 'all')" not in sub_code:
    sub_code = sub_code.replace(
        "const sanitized = clientName.trim().toLowerCase();",
        "const sanitized = clientName.trim().toLowerCase();\n\n        if (sanitized === 'all') {\n            return;\n        }"
    )

# Exclude joox-eg and joox from client discovery
if "'joox-eg'" not in sub_code:
    sub_code = sub_code.replace(
        "const systemDirs = ['bcknd', 'default', 'httpdocs', 'webmail', 'cgi-bin', 'error_docs'];",
        "const systemDirs = ['bcknd', 'default', 'httpdocs', 'webmail', 'cgi-bin', 'error_docs', 'joox-eg', 'joox'];"
    )

with open(subdomain_path, "w", encoding="utf-8") as f:
    f.write(sub_code)
print("1. SubdomainService patched.")

# 2. Patch update.service.ts
update_path = "/var/www/vhosts/systego.net/updater.systego.net/src/update/update.service.ts"
with open(update_path, "r", encoding="utf-8") as f:
    upd_code = f.read()

# Add excludes in refreshMasterFrontend
upd_code = upd_code.replace(
    "const frontendExcludes = ['node_modules', 'tmp', 'uploads', '.git', '.env'];",
    "const frontendExcludes = ['node_modules', 'tmp', 'uploads', '.git', '.env', 'cache', '.cache', '.turbo'];"
)

# Add excludes in syncFrontend
old_comp = """        const rawDiff = await this.fileSyncService.compareDirectories(
            paths.baseFrontend,
            paths.clientFrontend,
        );"""
new_comp = """        const frontendExcludes = [
            ...(this.configService.get<string[]>('app.excludedPaths') || []),
            'cache',
            '.cache',
            '.turbo',
        ];

        const rawDiff = await this.fileSyncService.compareDirectories(
            paths.baseFrontend,
            paths.clientFrontend,
            frontendExcludes,
        );"""
if old_comp in upd_code:
    upd_code = upd_code.replace(old_comp, new_comp)

# In syncFrontend: ensure injectApiUrlIntoBundle is ALWAYS called even if diff is empty
old_sync_tail = """            const clientApiUrl = `https://api-${clientName}.systego.net`;
            this.logger.log(`[Frontend Rebuild] Injecting API URL: ${clientApiUrl}`);
            await this.injectApiUrlIntoBundle(paths.clientFrontend, clientApiUrl);

            await this.fixOwnership(paths.clientFrontend);

            // Clear Next.js internal cache so it doesn't serve old pages
            const nextCacheDir = path.join(paths.clientFrontend, '.next', 'cache');
            try {
                await fs.rm(nextCacheDir, { recursive: true, force: true });
                this.logger.log(`[Frontend Rebuild] Cleared Next.js cache for ${clientName}`);
            } catch (e) {
                this.logger.warn(`[Frontend Rebuild] Could not clear Next.js cache: ${e}`);
            }
            
            // 🔥 التعديل هنا: إجبار سيرفر الفرونت إند (Next.js) إنه يعمل ريستارت عشان يقرأ التعديلات
            this.logger.log(`[Frontend Rebuild] Triggering Next.js server restart for ${clientName}...`);
            await this.triggerNodeRestart(paths.clientFrontend);

        } else {
            this.logger.log('[Frontend Sync] No changes detected, skipping.');
        }"""

new_sync_tail = """            this.logger.log(`[Frontend Sync] Finished copying files.`);
        } else {
            this.logger.log('[Frontend Sync] No changes detected, verifying personalization...');
        }

        const clientApiUrl = `https://api-${clientName}.systego.net`;
        this.logger.log(`[Frontend Rebuild] Injecting API URL: ${clientApiUrl}`);
        await this.injectApiUrlIntoBundle(paths.clientFrontend, clientApiUrl);

        await this.fixOwnership(paths.clientFrontend);

        const nextCacheDir = path.join(paths.clientFrontend, '.next', 'cache');
        try {
            await fs.rm(nextCacheDir, { recursive: true, force: true });
            this.logger.log(`[Frontend Rebuild] Cleared Next.js cache for ${clientName}`);
        } catch (e) {
            this.logger.warn(`[Frontend Rebuild] Could not clear Next.js cache: ${e}`);
        }

        this.logger.log(`[Frontend Rebuild] Triggering Next.js server restart for ${clientName}...`);
        await this.triggerNodeRestart(paths.clientFrontend);"""

if old_sync_tail in upd_code:
    upd_code = upd_code.replace(old_sync_tail, new_sync_tail)

# Add clientName === 'all' in checkForChanges, syncAll, syncFrontend, syncBackend
if "if (clientName === 'all')" not in upd_code:
    upd_code = upd_code.replace(
        """    async checkForChanges(clientName: string): Promise<UpdateResult> {
        this.subdomainService.validateClientName(clientName);""",
        """    async checkForChanges(clientName: string): Promise<UpdateResult> {
        this.subdomainService.validateClientName(clientName);

        if (clientName === 'all') {
            const clients = await this.subdomainService.listClientNames();
            const results: UpdateResult[] = [];
            for (const c of clients) {
                results.push(await this.checkForChanges(c));
            }
            return { clientName: 'all', dryRun: true, results } as any;
        }"""
    )

    upd_code = upd_code.replace(
        """    async syncAll(clientName: string): Promise<UpdateResult> {
        this.subdomainService.validateClientName(clientName);""",
        """    async syncAll(clientName: string): Promise<UpdateResult> {
        this.subdomainService.validateClientName(clientName);

        if (clientName === 'all') {
            const clients = await this.subdomainService.listClientNames();
            this.logger.log(`[Sync All] Syncing all ${clients.length} clients: ${clients.join(', ')}`);
            const results: UpdateResult[] = [];
            for (const c of clients) {
                try {
                    results.push(await this.syncAll(c));
                } catch (err: any) {
                    this.logger.error(`[Sync All] Failed to sync ${c}: ${err.message}`);
                }
            }
            return { clientName: 'all', dryRun: false, results } as any;
        }"""
    )

    upd_code = upd_code.replace(
        """    async syncFrontend(clientName: string): Promise<UpdateResult> {
        this.subdomainService.validateClientName(clientName);""",
        """    async syncFrontend(clientName: string): Promise<UpdateResult> {
        this.subdomainService.validateClientName(clientName);

        if (clientName === 'all') {
            const clients = await this.subdomainService.listClientNames();
            this.logger.log(`[Frontend Sync] Syncing all ${clients.length} clients: ${clients.join(', ')}`);
            const results: UpdateResult[] = [];
            for (const c of clients) {
                try {
                    results.push(await this.syncFrontend(c));
                } catch (err: any) {
                    this.logger.error(`[Frontend Sync] Failed to sync ${c}: ${err.message}`);
                }
            }
            return { clientName: 'all', dryRun: false, results } as any;
        }"""
    )

    upd_code = upd_code.replace(
        """    async syncBackend(clientName: string): Promise<UpdateResult> {
        this.subdomainService.validateClientName(clientName);""",
        """    async syncBackend(clientName: string): Promise<UpdateResult> {
        this.subdomainService.validateClientName(clientName);

        if (clientName === 'all') {
            const clients = await this.subdomainService.listClientNames();
            this.logger.log(`[Backend Sync] Syncing all ${clients.length} clients: ${clients.join(', ')}`);
            const results: UpdateResult[] = [];
            for (const c of clients) {
                try {
                    results.push(await this.syncBackend(c));
                } catch (err: any) {
                    this.logger.error(`[Backend Sync] Failed to sync ${c}: ${err.message}`);
                }
            }
            return { clientName: 'all', dryRun: false, results } as any;
        }"""
    )

# Fix injectApiUrlIntoBundle to skip node_modules and cache
old_inject = """    private async injectApiUrlIntoBundle(dirPath: string, newApiUrl: string): Promise<void> {
        const oldUrls = ['https://bcknd.systego.net', 'https://api-janssen.systego.net'];
        const clientMatch = newApiUrl.match(/https:\\/\\/api-([^.]+)\\.systego\\.net/);
        const clientName = clientMatch ? clientMatch[1] : '';

        const scanAndReplace = async (currentDir: string) => {
            let entries: any[];
            try {
                entries = await fs.readdir(currentDir, { withFileTypes: true });
            } catch {
                return;
            }

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    await scanAndReplace(fullPath);"""

new_inject = """    private async injectApiUrlIntoBundle(dirPath: string, newApiUrl: string): Promise<void> {
        const oldUrls = [
            'https://bcknd.systego.net',
            'http://bcknd.systego.net',
            'https://api-janssen.systego.net',
            'http://api-janssen.systego.net',
        ];
        const clientMatch = newApiUrl.match(/https?:\\/\\/api-([^.]+)\\.systego\\.net/);
        const clientName = clientMatch ? clientMatch[1] : '';

        const skipDirs = new Set([
            'node_modules',
            'node_modules.update-backup',
            'cache',
            '.cache',
            '.turbo',
            '.git',
            'tmp',
            'uploads',
            'logs',
        ]);

        const scanAndReplace = async (currentDir: string) => {
            let entries: any[];
            try {
                entries = await fs.readdir(currentDir, { withFileTypes: true });
            } catch {
                return;
            }

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    if (skipDirs.has(entry.name)) {
                        continue;
                    }
                    await scanAndReplace(fullPath);"""

if old_inject in upd_code:
    upd_code = upd_code.replace(old_inject, new_inject)
    print("injectApiUrlIntoBundle pattern replaced successfully!")
else:
    print("WARNING: old_inject pattern not matched directly, checking regex...")
    # fallback regex replace for injectApiUrlIntoBundle
    pattern = re.compile(
        r"private async injectApiUrlIntoBundle\(dirPath: string, newApiUrl: string\): Promise<void> \{\s*const oldUrls = \[[^\]]+\];\s*const clientMatch = [^;]+;\s*const clientName = [^;]+;\s*const scanAndReplace = async \(currentDir: string\) => \{\s*let entries: any\[\];\s*try \{\s*entries = await fs\.readdir\(currentDir, \{ withFileTypes: true \}\);\s*\} catch \{\s*return;\s*\}\s*for \(const entry of entries\) \{\s*const fullPath = path\.join\(currentDir, entry\.name\);\s*if \(entry\.isDirectory\(\)\) \{\s*await scanAndReplace\(fullPath\);",
        re.DOTALL
    )
    if pattern.search(upd_code):
        upd_code = pattern.sub(new_inject, upd_code, count=1)
        print("injectApiUrlIntoBundle regex replaced!")
    else:
        print("ERROR: could not replace injectApiUrlIntoBundle!")

with open(update_path, "w", encoding="utf-8") as f:
    f.write(upd_code)
print("2. UpdateService patched.")

# 3. Update .env
env_path = "/var/www/vhosts/systego.net/updater.systego.net/.env"
with open(env_path, "r", encoding="utf-8") as f:
    env_content = f.read()

env_content = re.sub(
    r"EXCLUDED_PATHS=.*",
    "EXCLUDED_PATHS=node_modules,.env,.git,.htaccess,uploads,tmp,logs,startup-error.log,app.js,.vite,dist_cache,cache,.cache,.turbo",
    env_content
)
with open(env_path, "w", encoding="utf-8") as f:
    f.write(env_content)
print("3. .env updated with cache exclusions.")

# 4. Clean cache in master-builds
os.system("rm -rf /var/www/vhosts/systego.net/master-builds/frontend-latest/.next/cache")
print("4. master-builds/.next/cache cleaned.")

# 5. Build updater
print("5. Building updater.systego.net...")
res = subprocess.run(
    ["npm", "run", "build"],
    cwd="/var/www/vhosts/systego.net/updater.systego.net",
    capture_output=True,
    text=True
)
print("Build stdout:", res.stdout)
if res.stderr:
    print("Build stderr:", res.stderr)
if res.returncode != 0:
    print("BUILD FAILED!")
    exit(1)
print("Build succeeded!")

# 6. Restart Passenger
os.system("mkdir -p /var/www/vhosts/systego.net/updater.systego.net/tmp && touch /var/www/vhosts/systego.net/updater.systego.net/tmp/restart.txt")
print("6. Passenger restarted.")
print("=== Patch complete! ===")
