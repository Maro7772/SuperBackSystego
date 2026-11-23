import { Router } from "express";
import { authenticated } from "../../middlewares/authenticated";
import { authorizeRole } from "../../middlewares/authorizeRole";
import {
  buildMasterHandler,
  syncHandler,
  syncSingleHandler,
  statusHandler,
  listJobsHandler,
} from "./UpdaterController";

const router = Router();

// All updater routes require super_admin
router.use(authenticated);
router.use(authorizeRole("super_admin"));

// Build master (pull + install + build)
router.post("/build-master", buildMasterHandler);

// Sync to ALL active clients (or a list)
router.post("/sync", syncHandler);

// Sync to a single client
router.post("/sync-single", syncSingleHandler);

// Get job status (polling)
router.get("/status/:jobId", statusHandler);

// List all recent jobs
router.get("/jobs", listJobsHandler);

export default router;
