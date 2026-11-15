import { Router } from 'express';
import { verifyTenant } from '../../controller/tenant/TenantController';
import { submitPayment, paymentStatus } from '../../controller/tenant/TenantPaymentController';
import { tenantAuth } from '../../middlewares/tenantAuth';

const router = Router();

// All tenant routes require API key authentication
router.use(tenantAuth);

// GET /api/tenant/verify - Verify tenant subscription and get feature flags
router.get('/verify', verifyTenant);

// POST /api/tenant/submit-payment - Submit a payment request (with screenshot) for approval
router.post('/submit-payment', submitPayment);

// GET /api/tenant/payment-status - Get latest payment status
router.get('/payment-status', paymentStatus);

export default router;
