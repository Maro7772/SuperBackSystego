import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { BadRequest } from "../../Errors/BadRequest";
import { SuccessResponse } from "../../utils/response";
import {
  buildMaster,
  syncBackendToClients,
  getJobStatus,
  listJobs,
} from "./UpdaterService";

// ═══════════════════════════════════════════════════════════════
// POST /api/admin/updater/build-master
// Pull + install + build the master backend template.
// Returns immediately — work runs in background.
// ═══════════════════════════════════════════════════════════════
export const buildMasterHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { jobId } = await buildMaster();
    SuccessResponse(res, {
      message: "Master build started in the background",
      data: { jobId },
    });
  }
);

// ═══════════════════════════════════════════════════════════════
// POST /api/admin/updater/sync
// Sync the latest master build to all (or specific) clients.
// Body: { clientNames?: string[], rebuildMaster?: boolean, forceDeps?: boolean }
// ═══════════════════════════════════════════════════════════════
export const syncHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { clientNames, rebuildMaster, forceDeps } = req.body;

    if (clientNames && !Array.isArray(clientNames)) {
      throw new BadRequest("clientNames must be an array of subdomain names");
    }

    const { jobId } = await syncBackendToClients({
      clientNames,
      rebuildMaster: rebuildMaster === true,
      forceDeps: forceDeps === true,
    });

    SuccessResponse(res, {
      message: clientNames
        ? `Sync started for ${clientNames.length} client(s) in the background`
        : "Sync started for ALL active clients in the background",
      data: { jobId },
    });
  }
);

// ═══════════════════════════════════════════════════════════════
// POST /api/admin/updater/sync-single
// Sync a single client by subdomain name.
// Body: { clientName: string, rebuildMaster?: boolean, forceDeps?: boolean }
// ═══════════════════════════════════════════════════════════════
export const syncSingleHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { clientName, rebuildMaster, forceDeps } = req.body;

    if (!clientName || typeof clientName !== "string") {
      throw new BadRequest("clientName is required");
    }

    const { jobId } = await syncBackendToClients({
      clientNames: [clientName.trim()],
      rebuildMaster: rebuildMaster === true,
      forceDeps: forceDeps === true,
    });

    SuccessResponse(res, {
      message: `Sync started for ${clientName} in the background`,
      data: { jobId },
    });
  }
);

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/updater/status/:jobId
// Poll the status of a background sync/build job.
// ═══════════════════════════════════════════════════════════════
export const statusHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const jobId = req.params.jobId;

    if (!jobId) {
      throw new BadRequest("jobId is required");
    }

    const job = getJobStatus(jobId);

    if (!job) {
      res.status(404).json({
        success: false,
        message: "Job not found",
      });
      return;
    }

    SuccessResponse(res, {
      message: `Job ${job.status}`,
      data: {
        jobId,
        status: job.status,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        totalClients: job.totalClients,
        completedClients: job.completedClients,
        failedClients: job.failedClients,
        currentClient: job.currentClient,
        error: job.error,
        log: job.log.slice(-50), // Last 50 log lines
      },
    });
  }
);

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/updater/jobs
// List all recent sync/build jobs.
// ═══════════════════════════════════════════════════════════════
export const listJobsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const jobs = listJobs();
    SuccessResponse(res, {
      message: "Recent jobs",
      data: jobs,
    });
  }
);
