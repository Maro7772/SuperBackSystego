"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectPayment = exports.approvePayment = exports.listAllPayments = exports.listPendingPayments = void 0;
const express_async_handler_1 = __importDefault(require("express-async-handler"));
const Payment_1 = require("../../models/schema/auth/Payment");
const response_1 = require("../../utils/response");
const TenantPaymentController_1 = require("../../controller/tenant/TenantPaymentController");
exports.listPendingPayments = (0, express_async_handler_1.default)(async (req, res) => {
    const payments = await Payment_1.PaymentModel.find({ status: "pending" }).sort({ createdAt: -1 }).populate("client_id", "company_name subdomain").populate("package_id", "name");
    return (0, response_1.SuccessResponse)(res, { message: "Pending payments retrieved.", data: payments }, 200);
});
exports.listAllPayments = (0, express_async_handler_1.default)(async (req, res) => {
    const payments = await Payment_1.PaymentModel.find().sort({ createdAt: -1 }).populate("client_id", "company_name subdomain").populate("package_id", "name");
    return (0, response_1.SuccessResponse)(res, { message: "Payments retrieved.", data: payments }, 200);
});
exports.approvePayment = (0, express_async_handler_1.default)(async (req, res) => {
    const { id } = req.params;
    const result = await (0, TenantPaymentController_1.approvePaymentById)(id);
    return (0, response_1.SuccessResponse)(res, { message: "Payment approved and subscription activated.", data: { clientId: result.client._id, newEndDate: result.newEnd } }, 200);
});
exports.rejectPayment = (0, express_async_handler_1.default)(async (req, res) => {
    const { id } = req.params;
    const payment = await (0, TenantPaymentController_1.rejectPaymentById)(id);
    return (0, response_1.SuccessResponse)(res, { message: "Payment rejected.", data: { paymentId: payment._id } }, 200);
});
