const fs = require('fs');
const path = require('path');
const { execBash } = require('./remote-exec');

async function uploadFileViaBash(remotePath, content) {
    console.log(`Uploading ${remotePath} (${content.length} chars)...`);
    const b64 = Buffer.from(content, 'utf8').toString('base64');
    const chunkSize = 5000;
    const totalChunks = Math.ceil(b64.length / chunkSize);

    await execBash(`rm -f /tmp/_upload.b64`);

    for (let i = 0; i < totalChunks; i++) {
        const chunk = b64.slice(i * chunkSize, (i + 1) * chunkSize);
        await execBash(`printf '%s' '${chunk}' >> /tmp/_upload.b64`);
    }

    const out = await execBash(`base64 -d /tmp/_upload.b64 > "${remotePath}" && rm -f /tmp/_upload.b64 && ls -la "${remotePath}"`);
    console.log(`Upload result:`, out);
}

const subdomainServiceContent = `import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Resolves filesystem paths for base and client subdomain directories.
 * Mirrors the path logic from ClientProvisioner.ts in Super-Systego.
 */
@Injectable()
export class SubdomainService {
    private readonly logger = new Logger(SubdomainService.name);

    private readonly vhostsDir: string;
    private readonly baseFrontendDir: string;
    private readonly baseBackendDir: string;

    constructor(private readonly configService: ConfigService) {
        this.vhostsDir = this.configService.get<string>('app.pleskVhostsDir')!;
        this.baseFrontendDir = this.configService.get<string>('app.baseFrontendDir')!;
        this.baseBackendDir = this.configService.get<string>('app.baseBackendDir')!;
    }

    getBaseFrontendPath(): string {
        return this.baseFrontendDir;
    }

    getBaseBackendPath(): string {
        return this.baseBackendDir;
    }

    getClientFrontendPath(clientName: string): string {
        return path.join(this.vhostsDir, clientName);
    }

    getClientBackendPath(clientName: string): string {
        return path.join(this.vhostsDir, \`api-\${clientName}\`);
    }

    validateClientName(clientName: string): void {
        if (!clientName || typeof clientName !== 'string') {
            throw new BadRequestException('clientName is required');
        }

        const sanitized = clientName.trim().toLowerCase();

        if (sanitized === 'all') {
            return;
        }

        if (sanitized.length < 2 || sanitized.length > 63) {
            throw new BadRequestException('clientName must be between 2 and 63 characters');
        }

        if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(sanitized)) {
            throw new BadRequestException(
                'clientName must be lowercase, alphanumeric with hyphens only, and cannot start/end with a hyphen',
            );
        }
    }

    async validatePathsExist(...paths: string[]): Promise<void> {
        for (const p of paths) {
            try {
                await fs.access(p);
            } catch {
                throw new BadRequestException(
                    \`Directory not found: \${p}. Ensure the client has been provisioned and paths are correct.\`,
                );
            }
        }
    }

    async listClientNames(): Promise<string[]> {
        const systemDirs = ['bcknd', 'default', 'httpdocs', 'webmail', 'cgi-bin', 'error_docs', 'joox-eg', 'joox'];

        try {
            const entries = await fs.readdir(this.vhostsDir);
            const clients: string[] = [];

            for (const name of entries) {
                if (name.startsWith('api-')) {
                    const clientName = name.substring(4);
                    if (!systemDirs.includes(clientName)) {
                        const frontendDir = path.join(this.vhostsDir, clientName);
                        try {
                            await fs.access(frontendDir);
                            clients.push(clientName);
                        } catch {
                        }
                    }
                }
            }

            this.logger.log(\`Discovered \${clients.length} client(s): \${clients.join(', ') || 'none'}\`);
            return clients;
        } catch (err: any) {
            this.logger.error(\`Failed to list clients: \${err.message}\`);
            return [];
        }
    }
}
`;

const updateServiceContent = `import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubdomainService } from '../subdomain/subdomain.service';
import { FileSyncService } from '../file-sync/file-sync.service';
import {
    FileDiffReport,
    SyncResult,
    UpdateResult,
    MasterRefreshResult,
} from '../common/interfaces/sync-result.interface';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Orchestrates the update process: resolves paths, compares files,
 * copies changes, and redeploys the backend (mirroring ClientProvisioner.ts).
 */
@Injectable()
export class UpdateService {
    private readonly logger = new Logger(UpdateService.name);

    constructor(
        private readonly configService: ConfigService,
        private readonly subdomainService: SubdomainService,
        private readonly fileSyncService: FileSyncService,
    ) { }

    // ============================================================================
    // Public API
    // ============================================================================

    async checkForChanges(clientName: string): Promise<UpdateResult> {
        this.subdomainService.validateClientName(clientName);

        if (clientName === 'all') {
            const clients = await this.subdomainService.listClientNames();
            const results: UpdateResult[] = [];
            for (const c of clients) {
                results.push(await this.checkForChanges(c));
            }
            return {
                clientName: 'all',
                dryRun: true,
                results,
            } as any;
        }

        const paths = this.resolvePaths(clientName);
        await this.subdomainService.validatePathsExist(
            paths.baseFrontend,
            paths.baseBackend,
            paths.clientFrontend,
            paths.clientBackend,
        );

        const frontendExcludes = [
            ...(this.configService.get<string[]>('app.excludedPaths') || []),
            'cache',
            '.cache',
            '.turbo',
        ];

        const frontendDiff = await this.fileSyncService.compareDirectories(
            paths.baseFrontend,
            paths.clientFrontend,
            frontendExcludes,
        );

        const backendDistDiff = await this.fileSyncService.compareDirectories(
            path.join(paths.baseBackend, 'dist'),
            path.join(paths.clientBackend, 'dist'),
        );

        const backendDrizzleDiff = await this.fileSyncService.compareDirectories(
            path.join(paths.baseBackend, 'drizzle'),
            path.join(paths.clientBackend, 'drizzle'),
        ).catch(() => ({ added: [], modified: [], deleted: [], unchanged: 0 })); 

        const backendRootDiff = await this.fileSyncService.compareSpecificFiles(
            paths.baseBackend,
            paths.clientBackend,
            ['package.json', 'package-lock.json'],
        );

        const backendDiff = this.mergeBackendDiffs(backendDistDiff, backendDrizzleDiff, backendRootDiff);

        return {
            clientName,
            dryRun: true,
            frontend: { diff: frontendDiff },
            backend: { diff: backendDiff },
        };
    }

    async syncAll(clientName: string): Promise<UpdateResult> {
        this.subdomainService.validateClientName(clientName);

        if (clientName === 'all') {
            const clients = await this.subdomainService.listClientNames();
            this.logger.log(\`[Sync All] Syncing all \${clients.length} clients: \${clients.join(', ')}\`);
            const results: UpdateResult[] = [];
            for (const c of clients) {
                try {
                    results.push(await this.syncAll(c));
                } catch (err: any) {
                    this.logger.error(\`[Sync All] Failed to sync \${c}: \${err.message}\`);
                }
            }
            return {
                clientName: 'all',
                dryRun: false,
                results,
            } as any;
        }

        const frontendResult = await this.syncFrontend(clientName);
        const backendResult = await this.syncBackend(clientName);

        return {
            clientName,
            dryRun: false,
            frontend: frontendResult.frontend,
            backend: backendResult.backend,
        };
    }

    // ============================================================================
    // Master Builds Refresh
    // ============================================================================

    async checkMasterChanges(): Promise<MasterRefreshResult> {
        const liveFrontend = this.configService.get<string>('app.liveFrontendDir')!;
        const liveBackend = this.configService.get<string>('app.liveBackendDir')!;
        const masterFrontend = this.configService.get<string>('app.baseFrontendDir')!;
        const masterBackend = this.configService.get<string>('app.baseBackendDir')!;

        await this.subdomainService.validatePathsExist(liveFrontend, liveBackend, masterFrontend, masterBackend);

        const frontendExcludes = ['node_modules', 'tmp', 'uploads', '.git', '.env', 'cache', '.cache', '.turbo'];
        const frontendDiff = await this.fileSyncService.compareDirectories(
            liveFrontend,
            masterFrontend,
            frontendExcludes,
        );

        const backendDistDiff = await this.fileSyncService.compareDirectories(
            path.join(liveBackend, 'dist'),
            path.join(masterBackend, 'dist'),
        );

        const backendDrizzleDiff = await this.fileSyncService.compareDirectories(
            path.join(liveBackend, 'drizzle'),
            path.join(masterBackend, 'drizzle'),
        ).catch(() => ({ added: [], modified: [], deleted: [], unchanged: 0 }));

        const backendRootDiff = await this.fileSyncService.compareSpecificFiles(
            liveBackend,
            masterBackend,
            ['package.json', 'package-lock.json'],
        );

        const backendDiff = this.mergeBackendDiffs(backendDistDiff, backendDrizzleDiff, backendRootDiff);

        return {
            dryRun: true,
            frontend: { diff: frontendDiff },
            backend: { diff: backendDiff },
        };
    }

    async refreshMaster(): Promise<MasterRefreshResult> {
        const frontendResult = await this.refreshMasterFrontend();
        const backendResult = await this.refreshMasterBackend();

        return {
            dryRun: false,
            frontend: frontendResult.frontend,
            backend: backendResult.backend,
        };
    }

    async refreshMasterFrontend(): Promise<MasterRefreshResult> {
        const liveFrontend = this.configService.get<string>('app.liveFrontendDir')!;
        const masterFrontend = this.configService.get<string>('app.baseFrontendDir')!;

        await this.subdomainService.validatePathsExist(liveFrontend, masterFrontend);

        const frontendExcludes = ['node_modules', 'tmp', 'uploads', '.git', '.env', 'cache', '.cache', '.turbo'];

        this.logger.log(\`[Master Refresh] Frontend: \${liveFrontend} → \${masterFrontend}\`);
        const diff = await this.fileSyncService.compareDirectories(liveFrontend, masterFrontend, frontendExcludes);

        let sync: SyncResult | undefined;
        if (diff.added.length > 0 || diff.modified.length > 0) {
            this.logger.log(\`[Master Refresh] Copying \${diff.added.length + diff.modified.length} frontend files...\`);
            sync = await this.fileSyncService.syncChanges(liveFrontend, masterFrontend, diff);
        } else {
            this.logger.log('[Master Refresh] Frontend: no changes detected.');
        }

        // Clean out any cache in master frontend if it slipped through
        const masterCacheDir = path.join(masterFrontend, '.next', 'cache');
        try {
            await fs.rm(masterCacheDir, { recursive: true, force: true });
        } catch {}

        return { dryRun: false, frontend: { diff, sync } };
    }

    async refreshMasterBackend(): Promise<MasterRefreshResult> {
        const liveBackend = this.configService.get<string>('app.liveBackendDir')!;
        const masterBackend = this.configService.get<string>('app.baseBackendDir')!;

        await this.subdomainService.validatePathsExist(liveBackend, masterBackend);

        this.logger.log(\`[Master Refresh] Backend: \${liveBackend} → \${masterBackend}\`);

        const distDiff = await this.fileSyncService.compareDirectories(
            path.join(liveBackend, 'dist'),
            path.join(masterBackend, 'dist'),
        );

        const drizzleDiff = await this.fileSyncService.compareDirectories(
            path.join(liveBackend, 'drizzle'),
            path.join(masterBackend, 'drizzle'),
        ).catch(() => ({ added: [], modified: [], deleted: [], unchanged: 0 }));

        const rootDiff = await this.fileSyncService.compareSpecificFiles(
            liveBackend,
            masterBackend,
            ['package.json', 'package-lock.json'],
        );

        const mergedDiff = this.mergeBackendDiffs(distDiff, drizzleDiff, rootDiff);

        let sync: SyncResult | undefined;
        const hasChanges = mergedDiff.added.length > 0 || mergedDiff.modified.length > 0;

        if (hasChanges) {
            const startedAt = new Date();
            const copiedFiles: string[] = [];
            const errors: Array<{ file: string; error: string }> = [];

            if (distDiff.added.length > 0 || distDiff.modified.length > 0) {
                this.logger.log(\`[Master Refresh] Copying dist files...\`);
                const distSync = await this.fileSyncService.syncChanges(
                    path.join(liveBackend, 'dist'),
                    path.join(masterBackend, 'dist'),
                    distDiff,
                );
                copiedFiles.push(...distSync.copiedFiles.map((f) => \`dist/\${f}\`));
                errors.push(...distSync.errors);
            }

            if (drizzleDiff.added.length > 0 || drizzleDiff.modified.length > 0) {
                this.logger.log(\`[Master Refresh] Copying Drizzle migrations...\`);
                const drizzleSync = await this.fileSyncService.syncChanges(
                    path.join(liveBackend, 'drizzle'),
                    path.join(masterBackend, 'drizzle'),
                    drizzleDiff,
                );
                copiedFiles.push(...drizzleSync.copiedFiles.map((f) => \`drizzle/\${f}\`));
                errors.push(...drizzleSync.errors);
            }

            if (rootDiff.added.length > 0 || rootDiff.modified.length > 0) {
                this.logger.log('[Master Refresh] Copying package files...');
                const rootSync = await this.fileSyncService.syncChanges(liveBackend, masterBackend, rootDiff);
                copiedFiles.push(...rootSync.copiedFiles);
                errors.push(...rootSync.errors);
            }

            sync = {
                success: errors.length === 0,
                copiedFiles,
                errors,
                startedAt,
                completedAt: new Date(),
            };
        } else {
            this.logger.log('[Master Refresh] Backend: no changes detected.');
        }

        return { dryRun: false, backend: { diff: mergedDiff, sync } };
    }

    async syncFrontend(clientName: string): Promise<UpdateResult> {
        this.subdomainService.validateClientName(clientName);

        if (clientName === 'all') {
            const clients = await this.subdomainService.listClientNames();
            this.logger.log(\`[Frontend Sync] Syncing all \${clients.length} clients: \${clients.join(', ')}\`);
            const results: UpdateResult[] = [];
            for (const c of clients) {
                try {
                    results.push(await this.syncFrontend(c));
                } catch (err: any) {
                    this.logger.error(\`[Frontend Sync] Failed to sync \${c}: \${err.message}\`);
                }
            }
            return {
                clientName: 'all',
                dryRun: false,
                results,
            } as any;
        }

        const paths = this.resolvePaths(clientName);
        await this.subdomainService.validatePathsExist(
            paths.baseFrontend,
            paths.clientFrontend,
        );

        this.logger.log(\`[Frontend Sync] Comparing \${paths.baseFrontend} → \${paths.clientFrontend}\`);

        const frontendExcludes = [
            ...(this.configService.get<string[]>('app.excludedPaths') || []),
            'cache',
            '.cache',
            '.turbo',
        ];

        const rawDiff = await this.fileSyncService.compareDirectories(
            paths.baseFrontend,
            paths.clientFrontend,
            frontendExcludes,
        );

        const diff = this.filterLogoFiles(rawDiff);

        let sync: SyncResult | undefined;

        if (diff.added.length > 0 || diff.modified.length > 0) {
            this.logger.log(\`[Frontend Sync] Copying \${diff.added.length + diff.modified.length} files...\`);
            sync = await this.fileSyncService.syncChanges(
                paths.baseFrontend,
                paths.clientFrontend,
                diff,
            );
        } else {
            this.logger.log('[Frontend Sync] No changes detected, verifying personalization...');
        }

        // Always personalize API URL and paths (ultra-fast, skips node_modules/cache)
        const clientApiUrl = \`https://api-\${clientName}.systego.net\`;
        this.logger.log(\`[Frontend Rebuild] Injecting API URL: \${clientApiUrl}\`);
        await this.injectApiUrlIntoBundle(paths.clientFrontend, clientApiUrl);

        await this.fixOwnership(paths.clientFrontend);

        // Clear Next.js internal cache so it doesn't serve old pages
        const nextCacheDir = path.join(paths.clientFrontend, '.next', 'cache');
        try {
            await fs.rm(nextCacheDir, { recursive: true, force: true });
            this.logger.log(\`[Frontend Rebuild] Cleared Next.js cache for \${clientName}\`);
        } catch (e) {
            this.logger.warn(\`[Frontend Rebuild] Could not clear Next.js cache: \${e}\`);
        }
        
        // إجبار سيرفر الفرونت إند (Next.js) إنه يعمل ريستارت عشان يقرأ التعديلات
        this.logger.log(\`[Frontend Rebuild] Triggering Next.js server restart for \${clientName}...\`);
        await this.triggerNodeRestart(paths.clientFrontend);

        return {
            clientName,
            dryRun: false,
            frontend: { diff, sync },
        };
    }

    async syncBackend(clientName: string): Promise<UpdateResult> {
        this.subdomainService.validateClientName(clientName);

        if (clientName === 'all') {
            const clients = await this.subdomainService.listClientNames();
            this.logger.log(\`[Backend Sync] Syncing all \${clients.length} clients: \${clients.join(', ')}\`);
            const results: UpdateResult[] = [];
            for (const c of clients) {
                try {
                    results.push(await this.syncBackend(c));
                } catch (err: any) {
                    this.logger.error(\`[Backend Sync] Failed to sync \${c}: \${err.message}\`);
                }
            }
            return {
                clientName: 'all',
                dryRun: false,
                results,
            } as any;
        }

        const paths = this.resolvePaths(clientName);
        await this.subdomainService.validatePathsExist(
            paths.baseBackend,
            paths.clientBackend,
        );

        this.logger.log(\`[Backend Sync] Comparing \${paths.baseBackend} → \${paths.clientBackend}\`);

        const distDiff = await this.fileSyncService.compareDirectories(
            path.join(paths.baseBackend, 'dist'),
            path.join(paths.clientBackend, 'dist'),
        );

        const drizzleDiff = await this.fileSyncService.compareDirectories(
            path.join(paths.baseBackend, 'drizzle'),
            path.join(paths.clientBackend, 'drizzle'),
        ).catch(() => ({ added: [], modified: [], deleted: [], unchanged: 0 }));

        const rootDiff = await this.fileSyncService.compareSpecificFiles(
            paths.baseBackend,
            paths.clientBackend,
            ['package.json', 'package-lock.json'],
        );

        const mergedDiff = this.mergeBackendDiffs(distDiff, drizzleDiff, rootDiff);

        let sync: SyncResult | undefined;
        const hasChanges = mergedDiff.added.length > 0 || mergedDiff.modified.length > 0;

        if (hasChanges) {
            const startedAt = new Date();
            const copiedFiles: string[] = [];
            const errors: Array<{ file: string; error: string }> = [];

            // 1. Sync dist/
            if (distDiff.added.length > 0 || distDiff.modified.length > 0) {
                this.logger.log(\`[Backend Sync] Copying dist files...\`);
                const distSync = await this.fileSyncService.syncChanges(
                    path.join(paths.baseBackend, 'dist'),
                    path.join(paths.clientBackend, 'dist'),
                    distDiff,
                );
                copiedFiles.push(...distSync.copiedFiles.map((f) => \`dist/\${f}\`));
                errors.push(...distSync.errors);
            }

            // 2. Sync drizzle/ migrations
            if (drizzleDiff.added.length > 0 || drizzleDiff.modified.length > 0) {
                this.logger.log(\`[Backend Sync] Copying Drizzle migration files...\`);
                const drizzleSync = await this.fileSyncService.syncChanges(
                    path.join(paths.baseBackend, 'drizzle'),
                    path.join(paths.clientBackend, 'drizzle'),
                    drizzleDiff,
                );
                copiedFiles.push(...drizzleSync.copiedFiles.map((f) => \`drizzle/\${f}\`));
                errors.push(...drizzleSync.errors);
            }

            // 3. Sync root files
            if (rootDiff.added.length > 0 || rootDiff.modified.length > 0) {
                this.logger.log('[Backend Sync] Copying package files...');
                const rootSync = await this.fileSyncService.syncChanges(
                    paths.baseBackend,
                    paths.clientBackend,
                    rootDiff,
                );
                copiedFiles.push(...rootSync.copiedFiles);
                errors.push(...rootSync.errors);
            }

            // 4. Redeploy & Run Migrations
            const packageChanged = rootDiff.added.length > 0 || rootDiff.modified.length > 0;
            const dbChanged = drizzleDiff.added.length > 0 || drizzleDiff.modified.length > 0;
            
            await this.redeployBackend(clientName, paths.clientBackend, packageChanged, dbChanged);

            sync = {
                success: errors.length === 0,
                copiedFiles,
                errors,
                startedAt,
                completedAt: new Date(),
            };
        } else {
            this.logger.log('[Backend Sync] No changes detected, skipping.');
        }

        return {
            clientName,
            dryRun: false,
            backend: { diff: mergedDiff, sync },
        };
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    private resolvePaths(clientName: string) {
        return {
            baseFrontend: this.subdomainService.getBaseFrontendPath(),
            baseBackend: this.subdomainService.getBaseBackendPath(),
            clientFrontend: this.subdomainService.getClientFrontendPath(clientName),
            clientBackend: this.subdomainService.getClientBackendPath(clientName),
        };
    }

    private mergeBackendDiffs(
        distDiff: FileDiffReport,
        drizzleDiff: FileDiffReport,
        rootDiff: FileDiffReport,
    ): FileDiffReport {
        return {
            added: [
                ...distDiff.added.map((f) => \`dist/\${f}\`),
                ...drizzleDiff.added.map((f) => \`drizzle/\${f}\`),
                ...rootDiff.added,
            ],
            modified: [
                ...distDiff.modified.map((f) => \`dist/\${f}\`),
                ...drizzleDiff.modified.map((f) => \`drizzle/\${f}\`),
                ...rootDiff.modified,
            ],
            unchanged: distDiff.unchanged + drizzleDiff.unchanged + rootDiff.unchanged,
            deleted: [
                ...distDiff.deleted.map((f) => \`dist/\${f}\`),
                ...drizzleDiff.deleted.map((f) => \`drizzle/\${f}\`),
                ...rootDiff.deleted,
            ],
        };
    }

    private async redeployBackend(
        clientName: string,
        backendDir: string,
        packageChanged: boolean,
        dbChanged: boolean,
    ): Promise<void> {
        this.logger.log(\`[Redeploy] Starting redeployment for api-\${clientName}...\`);

        try {
            if (packageChanged) {
                this.logger.log('[Redeploy] Package files changed — running npm install --production...');
                const { stdout, stderr } = await execAsync('npm install --production', {
                    cwd: backendDir,
                    timeout: 120000,
                });

                if (stdout) this.logger.log(\`[Redeploy] npm: \${stdout.trim()}\`);
                if (stderr) this.logger.warn(\`[Redeploy] npm stderr: \${stderr.trim()}\`);
            }

            await this.fixOwnership(backendDir);
            await this.triggerNodeRestart(backendDir);

            this.logger.log(\`[Redeploy] ✅ Redeployment complete for api-\${clientName}\`);
        } catch (err: any) {
            this.logger.error(\`[Redeploy] ❌ Redeployment failed for api-\${clientName}: \${err.message}\`);
            throw err;
        }
    }

    private async fixOwnership(dir: string): Promise<void> {
        this.logger.log(\`[Permissions] Fixing ownership and permissions on \${dir}...\`);

        try {
            await execAsync(\`chown -R systego:psacln \${dir}\`);
            this.logger.log(\`[Permissions] ✅ chown -R systego:psacln succeeded\`);
        } catch (err: any) {
            this.logger.warn(\`[Permissions] ⚠️ chown failed: \${err.message}\`);
        }

        try {
            await execAsync(\`find \${dir} -type d -exec chmod 755 {} +\`);
            await execAsync(\`find \${dir} -type f -exec chmod 644 {} +\`);
            this.logger.log(\`[Permissions] ✅ chmod 755/644 applied successfully\`);
        } catch (err: any) {
            this.logger.error(\`[Permissions] ❌ chmod failed: \${err.message}\`);
        }
    }

    private async triggerNodeRestart(destDir: string): Promise<void> {
        const tmpDir = path.join(destDir, 'tmp');
        
        await fs.mkdir(tmpDir, { recursive: true }).catch(() => { });
        try {
            await execAsync(\`chmod 777 \${tmpDir}\`);
        } catch (e) {
             this.logger.warn(\`Could not set 777 on tmp dir: \${e}\`);
        }

        const restartFile = path.join(tmpDir, 'restart.txt');
        const time = new Date();

        try {
            await fs.utimes(restartFile, time, time);
        } catch {
            await fs.writeFile(restartFile, 'restart time: ' + time.toISOString());
        }

        try {
            await execAsync(\`chmod 666 \${restartFile}\`);
        } catch (e) {}

        this.logger.log('[Redeploy] Triggered Node.js restart (tmp/restart.txt)');
    }

    private filterLogoFiles(diff: FileDiffReport): FileDiffReport {
        const isLogoFile = (filePath: string): boolean => {
            const normalized = filePath.replace(/\\\\/g, '/');
            const basename = normalized.split('/').pop() || '';
            return (
                normalized.includes('assets/') &&
                basename.startsWith('logo-') &&
                basename.endsWith('.png')
            );
        };

        const filteredAdded = diff.added.filter((f) => !isLogoFile(f));
        const filteredModified = diff.modified.filter((f) => !isLogoFile(f));

        const logoSkipped = (diff.added.length - filteredAdded.length) + (diff.modified.length - filteredModified.length);
        if (logoSkipped > 0) {
            this.logger.log(\`[Frontend Sync] Preserved \${logoSkipped} client logo file(s) — skipped from sync.\`);
        }

        return {
            added: filteredAdded,
            modified: filteredModified,
            unchanged: diff.unchanged,
            deleted: diff.deleted,
        };
    }

    private async injectApiUrlIntoBundle(dirPath: string, newApiUrl: string): Promise<void> {
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
                    await scanAndReplace(fullPath);
                } else if (
                    entry.isFile() &&
                    (entry.name.endsWith('.js') ||
                     entry.name.endsWith('.mjs') ||
                     entry.name.endsWith('.html') ||
                     entry.name.endsWith('.json') ||
                     entry.name === '.env')
                ) {
                    try {
                        let content = await fs.readFile(fullPath, 'utf8');

                        let modified = false;
                        for (const oldUrl of oldUrls) {
                            if (content.toLowerCase().includes(oldUrl.toLowerCase())) {
                                const regex = new RegExp(oldUrl.replace(/[.*+?^$\{}()|[\\]\\\\]/g, '\\\\$&'), 'gi');
                                content = content.replace(regex, newApiUrl);
                                modified = true;
                            }
                        }

                        if (clientName && (fullPath.includes('.next') || entry.name.endsWith('.json') || entry.name.endsWith('.js'))) {
                            if (content.includes('/subdomains/janssen')) {
                                content = content.replace(/\\/subdomains\\/janssen/g, \`/subdomains/\${clientName}\`);
                                modified = true;
                            }
                            if (content.includes('/httpdocs')) {
                                content = content.replace(/\\/httpdocs/g, \`/subdomains/\${clientName}\`);
                                modified = true;
                            }
                        }

                        if (modified) {
                            await fs.writeFile(fullPath, content, 'utf8');
                            this.logger.log(\`[Frontend Rebuild] Personalized \${entry.name} for \${clientName || newApiUrl}\`);
                        }
                    } catch (err: any) {
                        this.logger.warn(\`[Frontend Rebuild] Skipping \${entry.name} during injection: \${err.message}\`);
                    }
                }
            }
        };

        await scanAndReplace(dirPath);
        this.logger.log(\`[Frontend Rebuild] Finished injecting \${newApiUrl} into compiled React bundles.\`);
    }
}
`;

async function main() {
    console.log('=== Step 1: Uploading SubdomainService ===');
    await uploadFileViaBash('/var/www/vhosts/systego.net/updater.systego.net/src/subdomain/subdomain.service.ts', subdomainServiceContent);

    console.log('=== Step 2: Uploading UpdateService ===');
    await uploadFileViaBash('/var/www/vhosts/systego.net/updater.systego.net/src/update/update.service.ts', updateServiceContent);

    console.log('=== Step 3: Updating .env EXCLUDED_PATHS and Cleaning cache ===');
    const step3 = await execBash("sed -i 's|EXCLUDED_PATHS=.*|EXCLUDED_PATHS=node_modules,.env,.git,.htaccess,uploads,tmp,logs,startup-error.log,app.js,.vite,dist_cache,cache,.cache,.turbo|g' /var/www/vhosts/systego.net/updater.systego.net/.env && rm -rf /var/www/vhosts/systego.net/master-builds/frontend-latest/.next/cache && echo 'Cleaned cache and updated .env'");
    console.log(step3);

    console.log('=== Step 4: Building updater.systego.net ===');
    const buildRes = await execBash("cd /var/www/vhosts/systego.net/updater.systego.net && npm run build");
    console.log(buildRes);

    console.log('=== Step 5: Restarting updater Passenger app ===');
    const restartRes = await execBash("mkdir -p /var/www/vhosts/systego.net/updater.systego.net/tmp && touch /var/www/vhosts/systego.net/updater.systego.net/tmp/restart.txt && echo 'Passenger restarted'");
    console.log(restartRes);

    console.log('=== Done! ===');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
