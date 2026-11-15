import { Router } from "express";
import {
  getOperationReportById,
  getOperationReports,
  addNote,
  deleteNote,
  updateOperationReportStatus,
} from "../../controller/admin/OperationReportsController";
import { authenticated } from "../../middlewares/authenticated";

const router = Router();

router.use(authenticated);

router.get("/", getOperationReports);
router.get("/:id", getOperationReportById);
router.patch("/:id/status", updateOperationReportStatus);
router.patch("/:id", updateOperationReportStatus);
router.post("/:id/notes", addNote);
router.delete("/:id/notes/:noteIndex", deleteNote);

export default router;
