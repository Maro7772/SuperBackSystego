"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const TenantController_1 = require("../../controller/tenant/TenantController");
const TenantPaymentController_1 = require("../../controller/tenant/TenantPaymentController");
const tenantAuth_1 = require("../../middlewares/tenantAuth");
const router = (0, express_1.Router)();
// All tenant routes require API key authentication
router.use(tenantAuth_1.tenantAuth);
// GET /api/tenant/verify - Verify tenant subscription and get feature flags
router.get('/verify', TenantController_1.verifyTenant);
// POST /api/tenant/submit-payment - Submit a payment request (with screenshot) for approval
router.post('/submit-payment', TenantPaymentController_1.submitPayment);
// GET /api/tenant/payment-status - Get latest payment status
router.get('/payment-status', TenantPaymentController_1.paymentStatus);
exports.default = router;
