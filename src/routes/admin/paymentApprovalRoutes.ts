import { Router } from "express";
import { listPendingPayments, listAllPayments, approvePayment, rejectPayment } from "../../controller/admin/PaymentApprovalController";
import { authenticated } from "../../middlewares/authenticated";
import { authorizeRole } from "../../middlewares/authorizeRole";

const router = Router();
router.use(authenticated);
router.use(authorizeRole("super_admin"));

router.get("/", listAllPayments);
router.get("/pending", listPendingPayments);
router.post("/:id/approve", approvePayment);
router.post("/:id/reject", rejectPayment);

export default router;
