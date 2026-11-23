/**
 * UpdaterService — Zero-downtime backend updater for all Systego client subdomains.
 *
 * HOW IT WORKS:
 *   1.  Pulls the latest Systego code into master-builds/backend-latest.
 *   2.  Runs `npm install` and `npm run build` on the master copy.
 *   3.  For each client subdomain, copies the new dist/ (and optionally node_modules)
 *       into the client's api-{name} directory.
 *   4.  Touches tmp/restart.txt so Phusion Passenger restarts the app — ONLY after
 *       the new files are fully in place (zero-downtime).
 *
 * Everything runs sequentially per-client (to avoid overloading the server)
 * and entirely in the background so the HTTP response returns immediately.
 */

import { exec } from "child_process";
import util from "util";
import path from "path";
import fs from "fs/promises";
import { ClientModel } from "../../models/schema/auth/Client";
import { executePleskCli } from "../../utils/PleskService";

const execAsync = util.promisify(exec);

// ─── Configuration ─────────────────────────────────────────────────
const PLESK_VHOSTS_DIR =
  process.env.PLESK_VHOSTS_DIR || "/var/www/vhosts/systego.net/subdomains";
const MASTER_BACKEND_DIR =
  process.env.MASTER_BACKEND_DIR ||
  "/var/www/vhosts/systego.net/master-builds/backend-latest";
const SYSTEGO_REPO_URL =
  process.env.SYSTEGO_REPO_URL || ""; // git remote URL — set in .env

// ─── In-memory state for sync jobs ────────────────────────────────
interface SyncJob {
  status: "queued" | "building_master" | "syncing_clients" | "done" | "error";
  startedAt: Date;
  finishedAt?: Date;
  totalClients: number;
  completedClients: number;
  failedClients: string[];
  currentClient?: string;
  error?: string;
  log: string[];
}

const activeJobs = new Map<string, SyncJob>();

// ─── Public API ────────────────────────────────────────────────────

/**
 * Build the master backend from git (pull → npm install → npm run build).
 * Returns immediately — the build runs in the background.
 */
export async function buildMaster(): Promise<{ jobId: string }> {
  const jobId = `master-${Date.now()}`;
  const job: SyncJob = {
    status: "building_master",
    startedAt: new Date(),
    totalClients: 0,
    completedClients: 0,
    failedClients: [],
    log: [],
  };
  activeJobs.set(jobId, job);

  // Run in background — do NOT await
  _buildMasterAsync(job).catch((err) => {
    job.status = "error";
    job.error = err.message;
    job.finishedAt = new Date();
  });

  return { jobId };
}

/**
 * Sync backend to ALL active clients (or a specific list).
 * Optionally rebuilds master first.
 */
export async function syncBackendToClients(opts: {
  clientNames?: string[];  // specific clients, or empty = all active
  rebuildMaster?: boolean; // pull + build master first?
  forceDeps?: boolean;     // re-copy node_modules even if already present?
}): Promise<{ jobId: string }> {
  const jobId = `sync-${Date.now()}`;
  const job: SyncJob = {
    status: "queued",
    startedAt: new Date(),
    totalClients: 0,
    completedClients: 0,
    failedClients: [],
    log: [],
  };
  activeJobs.set(jobId, job);

  _syncAllAsync(jobId, job, opts).catch((err) => {
    job.status = "error";
    job.error = err.message;
    job.finishedAt = new Date();
  });

  return { jobId };
}

/**
 * Get the status of a job.
 */
export function getJobStatus(jobId: string): SyncJob | null {
  return activeJobs.get(jobId) || null;
}

/**
 * List all recent jobs.
 */
export function listJobs(): { jobId: string; status: string; startedAt: Date }[] {
  const result: { jobId: string; status: string; startedAt: Date }[] = [];
  for (const [jobId, job] of activeJobs) {
    result.push({ jobId, status: job.status, startedAt: job.startedAt });
  }
  return result.reverse();
}

// ─── Private implementation ────────────────────────────────────────

async function _buildMasterAsync(job: SyncJob): Promise<void> {
  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    job.log.push(line);
    console.log(`[Updater] ${msg}`);
  };

  job.status = "building_master";
  log(`Building master in ${MASTER_BACKEND_DIR}...`);

  // Check if master directory exists
  try {
    await fs.access(MASTER_BACKEND_DIR);
  } catch {
    throw new Error(`Master backend directory not found: ${MASTER_BACKEND_DIR}`);
  }

  // 1. Git pull
  try {
    log("Running git pull...");
    const { stdout: gitOut } = await execAsync("git pull", {
      cwd: MASTER_BACKEND_DIR,
      timeout: 120_000,
    });
    log(`git pull: ${gitOut.trim()}`);
  } catch (err: any) {
    log(`git pull warning: ${err.message}`);
    // Continue even if git pull fails (might not be a git repo)
  }

  // 2. npm install
  log("Running npm install...");
  try {
    const { stdout: npmOut } = await execAsync("npm install --production=false", {
      cwd: MASTER_BACKEND_DIR,
      timeout: 600_000, // 10 minutes
    });
    log(`npm install done (${npmOut.split("\n").length} lines)`);
  } catch (err: any) {
    throw new Error(`npm install failed: ${err.message}`);
  }

  // 3. npm run build
  log("Running npm run build...");
  try {
    const { stdout: buildOut } = await execAsync("npm run build", {
      cwd: MASTER_BACKEND_DIR,
      timeout: 300_000, // 5 minutes
    });
    log(`npm run build done (${buildOut.split("\n").length} lines)`);
  } catch (err: any) {
    throw new Error(`npm run build failed: ${err.message}`);
  }

  // 4. Verify dist/src/server.js exists
  const serverJsPath = path.join(MASTER_BACKEND_DIR, "dist", "src", "server.js");
  try {
    await fs.access(serverJsPath);
    log("✅ dist/src/server.js verified");
  } catch {
    throw new Error("Build completed but dist/src/server.js is missing!");
  }

  job.status = "done";
  job.finishedAt = new Date();
  log("✅ Master build completed successfully");
}

async function _syncAllAsync(
  jobId: string,
  job: SyncJob,
  opts: { clientNames?: string[]; rebuildMaster?: boolean; forceDeps?: boolean }
): Promise<void> {
  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    job.log.push(line);
    console.log(`[Updater:${jobId}] ${msg}`);
  };

  // Step 1: Optionally rebuild master
  if (opts.rebuildMaster) {
    job.status = "building_master";
    log("Rebuilding master first...");
    await _buildMasterAsync(job);
  }

  // Step 2: Get list of clients to update
  job.status = "syncing_clients";
  let clients: Array<{ subdomain?: string; company_name?: string }>;

  if (opts.clientNames && opts.clientNames.length > 0) {
    clients = await ClientModel.find({
      subdomain: { $in: opts.clientNames },
      provisioning_status: "completed",
    }).select("subdomain company_name").lean() as any[];
  } else {
    clients = await ClientModel.find({
      subdomain: { $exists: true, $ne: null },
      provisioning_status: "completed",
      status: "active",
    }).select("subdomain company_name").lean() as any[];
  }

  // Filter out clients without subdomain
  clients = clients.filter((c) => !!c.subdomain);

  job.totalClients = clients.length;
  log(`Found ${clients.length} clients to update`);

  if (clients.length === 0) {
    job.status = "done";
    job.finishedAt = new Date();
    log("No clients to update");
    return;
  }

  // Step 3: Update each client sequentially
  for (const client of clients) {
    const clientName = client.subdomain!;
    job.currentClient = clientName;
    log(`─── Updating ${clientName} (${client.company_name}) ───`);

    try {
      await _syncSingleClient(clientName, opts.forceDeps || false, log);
      job.completedClients++;
      log(`✅ ${clientName} updated successfully`);
    } catch (err: any) {
      job.failedClients.push(clientName);
      job.completedClients++;
      log(`❌ ${clientName} failed: ${err.message}`);
    }

    // Small delay between clients to avoid overloading the server
    await new Promise((r) => setTimeout(r, 2000));
  }

  job.currentClient = undefined;
  job.status = job.failedClients.length > 0 ? "done" : "done";
  job.finishedAt = new Date();
  log(
    `════ Sync complete: ${job.completedClients - job.failedClients.length}/${job.totalClients} succeeded, ${job.failedClients.length} failed ════`
  );
}

async function _syncSingleClient(
  clientName: string,
  forceDeps: boolean,
  log: (msg: string) => void
): Promise<void> {
  const backendDir = path.join(PLESK_VHOSTS_DIR, `api-${clientName}`);

  // 1. Verify client directory exists
  try {
    await fs.access(backendDir);
  } catch {
    throw new Error(`Client directory not found: ${backendDir}`);
  }

  // 2. Preserve the client-specific .env file
  const envPath = path.join(backendDir, ".env");
  let envBackup: string | null = null;
  try {
    envBackup = await fs.readFile(envPath, "utf-8");
  } catch {
    log(`Warning: No .env found for ${clientName}`);
  }

  // 3. Copy new dist/ folder (the compiled TypeScript output)
  log(`Copying dist/ to ${clientName}...`);
  const masterDist = path.join(MASTER_BACKEND_DIR, "dist");
  const clientDist = path.join(backendDir, "dist");

  // Remove old dist and copy new one atomically
  const clientDistNew = `${clientDist}.new`;
  const clientDistOld = `${clientDist}.old`;
  try {
    // Copy master dist to a temp location
    await execAsync(`cp -a ${masterDist} ${clientDistNew}`, { timeout: 120_000 });

    // Atomic swap: rename old dist, rename new dist, delete old
    try {
      await execAsync(`mv ${clientDist} ${clientDistOld}`);
    } catch {
      // Old dist didn't exist, that's fine
    }
    await execAsync(`mv ${clientDistNew} ${clientDist}`);
    // Clean up old dist in background
    execAsync(`rm -rf ${clientDistOld}`).catch(() => {});
  } catch (err: any) {
    // Cleanup temp dir on failure
    execAsync(`rm -rf ${clientDistNew}`).catch(() => {});
    throw new Error(`Failed to copy dist: ${err.message}`);
  }

  // 4. Copy package.json and package-lock.json (for dependency tracking)
  try {
    const masterPkg = path.join(MASTER_BACKEND_DIR, "package.json");
    const masterLock = path.join(MASTER_BACKEND_DIR, "package-lock.json");
    await execAsync(`cp ${masterPkg} ${backendDir}/package.json`);
    try {
      await execAsync(`cp ${masterLock} ${backendDir}/package-lock.json`);
    } catch {
      // lock file might not exist
    }
  } catch (err: any) {
    log(`Warning: Could not copy package.json: ${err.message}`);
  }

  // 5. Copy node_modules if forced or if they don't exist
  const clientNm = path.join(backendDir, "node_modules");
  const hasNm = await fs.access(clientNm).then(() => true).catch(() => false);

  if (forceDeps || !hasNm) {
    log(`Copying node_modules to ${clientName}...`);
    const masterNm = path.join(MASTER_BACKEND_DIR, "node_modules");
    try {
      if (hasNm) {
        await execAsync(`rm -rf ${clientNm}`);
      }
      await execAsync(`cp -a ${masterNm} ${backendDir}/`, { timeout: 300_000 });
      log("node_modules copied");
    } catch (err: any) {
      log(`Warning: node_modules copy failed: ${err.message}`);
    }
  }

  // 6. Regenerate app.js shim (in case it was lost or corrupted)
  const appJsPath = path.join(backendDir, "app.js");
  const appJsContent = `const fs = require('fs');
const path = require('path');
const logFile = path.join(__dirname, 'startup-error.log');

process.on('uncaughtException', (err) => {
    const msg = new Date().toISOString() + ' [UNCAUGHT EXCEPTION] ' + err.stack + '\\n';
    fs.appendFileSync(logFile, msg);
    console.error(msg);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    const msg = new Date().toISOString() + ' [UNHANDLED REJECTION] ' + String(reason) + '\\n';
    fs.appendFileSync(logFile, msg);
    console.error(msg);
});

try {
    require('./dist/src/server.js');
} catch (err) {
    const msg = new Date().toISOString() + ' [STARTUP CRASH] ' + err.stack + '\\n';
    fs.appendFileSync(logFile, msg);
    console.error(msg);
    process.exit(1);
}
`;
  await fs.writeFile(appJsPath, appJsContent, "utf-8");

  // 7. Restore client-specific .env
  if (envBackup) {
    await fs.writeFile(envPath, envBackup, "utf-8");
  }

  // 8. Fix permissions
  try {
    await execAsync(`chown -R systego:psacln ${backendDir}`);
    await execAsync(`chmod -R 755 ${backendDir}`);
  } catch (err: any) {
    log(`Warning: Permission fix failed: ${err.message}`);
  }

  // 9. Restart Passenger (only now, after everything is in place)
  log(`Restarting Passenger for ${clientName}...`);
  try {
    const tmpDir = path.join(backendDir, "tmp");
    await fs.mkdir(tmpDir, { recursive: true }).catch(() => {});
    const time = new Date();
    const restartFile = path.join(tmpDir, "restart.txt");
    try {
      await fs.utimes(restartFile, time, time);
    } catch {
      await fs.writeFile(restartFile, `restart: ${time.toISOString()}`);
    }
  } catch (err: any) {
    log(`Warning: Passenger restart failed: ${err.message}`);
  }

  // 10. Also restart via Plesk CLI for good measure
  try {
    const apiSubdomain = `api-${clientName}.systego.net`;
    await executePleskCli("extension", [
      "--call", "nodejs",
      "--restart",
      "-domain", apiSubdomain,
    ]);
  } catch (err: any) {
    log(`Warning: Plesk CLI restart failed: ${err.message}`);
  }
}
