"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authenticated_1 = require("../../middlewares/authenticated");
const authorizeRole_1 = require("../../middlewares/authorizeRole");
const UpdaterController_1 = require("./UpdaterController");
const router = (0, express_1.Router)();
// All updater routes require super_admin
router.use(authenticated_1.authenticated);
router.use((0, authorizeRole_1.authorizeRole)("super_admin"));
// Build master (pull + install + build)
router.post("/build-master", UpdaterController_1.buildMasterHandler);
// Sync to ALL active clients (or a list)
router.post("/sync", UpdaterController_1.syncHandler);
// Sync to a single client
router.post("/sync-single", UpdaterController_1.syncSingleHandler);
// Get job status (polling)
router.get("/status/:jobId", UpdaterController_1.statusHandler);
// List all recent jobs
router.get("/jobs", UpdaterController_1.listJobsHandler);
exports.default = router;
