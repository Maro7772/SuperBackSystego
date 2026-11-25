"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listJobsHandler = exports.statusHandler = exports.syncSingleHandler = exports.syncHandler = exports.buildMasterHandler = void 0;
const express_async_handler_1 = __importDefault(require("express-async-handler"));
const BadRequest_1 = require("../../Errors/BadRequest");
const response_1 = require("../../utils/response");
const UpdaterService_1 = require("./UpdaterService");
// ═══════════════════════════════════════════════════════════════
// POST /api/admin/updater/build-master
// Pull + install + build the master backend template.
// Returns immediately — work runs in background.
// ═══════════════════════════════════════════════════════════════
exports.buildMasterHandler = (0, express_async_handler_1.default)(async (req, res) => {
    const { jobId } = await (0, UpdaterService_1.buildMaster)();
    (0, response_1.SuccessResponse)(res, {
        message: "Master build started in the background",
        data: { jobId },
    });
});
// ═══════════════════════════════════════════════════════════════
// POST /api/admin/updater/sync
// Sync the latest master build to all (or specific) clients.
// Body: { clientNames?: string[], rebuildMaster?: boolean, forceDeps?: boolean }
// ═══════════════════════════════════════════════════════════════
exports.syncHandler = (0, express_async_handler_1.default)(async (req, res) => {
    const { clientNames, rebuildMaster, forceDeps } = req.body;
    if (clientNames && !Array.isArray(clientNames)) {
        throw new BadRequest_1.BadRequest("clientNames must be an array of subdomain names");
    }
    const { jobId } = await (0, UpdaterService_1.syncBackendToClients)({
        clientNames,
        rebuildMaster: rebuildMaster === true,
        forceDeps: forceDeps === true,
    });
    (0, response_1.SuccessResponse)(res, {
        message: clientNames
            ? `Sync started for ${clientNames.length} client(s) in the background`
            : "Sync started for ALL active clients in the background",
        data: { jobId },
    });
});
// ═══════════════════════════════════════════════════════════════
// POST /api/admin/updater/sync-single
// Sync a single client by subdomain name.
// Body: { clientName: string, rebuildMaster?: boolean, forceDeps?: boolean }
// ═══════════════════════════════════════════════════════════════
exports.syncSingleHandler = (0, express_async_handler_1.default)(async (req, res) => {
    const { clientName, rebuildMaster, forceDeps } = req.body;
    if (!clientName || typeof clientName !== "string") {
        throw new BadRequest_1.BadRequest("clientName is required");
    }
    const { jobId } = await (0, UpdaterService_1.syncBackendToClients)({
        clientNames: [clientName.trim()],
        rebuildMaster: rebuildMaster === true,
        forceDeps: forceDeps === true,
    });
    (0, response_1.SuccessResponse)(res, {
        message: `Sync started for ${clientName} in the background`,
        data: { jobId },
    });
});
// ═══════════════════════════════════════════════════════════════
// GET /api/admin/updater/status/:jobId
// Poll the status of a background sync/build job.
// ═══════════════════════════════════════════════════════════════
exports.statusHandler = (0, express_async_handler_1.default)(async (req, res) => {
    const jobId = req.params.jobId;
    if (!jobId) {
        throw new BadRequest_1.BadRequest("jobId is required");
    }
    const job = (0, UpdaterService_1.getJobStatus)(jobId);
    if (!job) {
        res.status(404).json({
            success: false,
            message: "Job not found",
        });
        return;
    }
    (0, response_1.SuccessResponse)(res, {
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
});
// ═══════════════════════════════════════════════════════════════
// GET /api/admin/updater/jobs
// List all recent sync/build jobs.
// ═══════════════════════════════════════════════════════════════
exports.listJobsHandler = (0, express_async_handler_1.default)(async (req, res) => {
    const jobs = (0, UpdaterService_1.listJobs)();
    (0, response_1.SuccessResponse)(res, {
        message: "Recent jobs",
        data: jobs,
    });
});
