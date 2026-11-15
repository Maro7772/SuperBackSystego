"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectPaymentById = exports.approvePaymentById = exports.paymentStatus = exports.submitPayment = void 0;
const express_async_handler_1 = __importDefault(require("express-async-handler"));
const Client_1 = require("../../models/schema/auth/Client");
const Package_1 = require("../../models/schema/auth/Package");
const Payment_1 = require("../../models/schema/auth/Payment");
const NotFound_1 = require("../../Errors/NotFound");
const unauthorizedError_1 = require("../../Errors/unauthorizedError");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const CYCLE_PRICE_FIELD = {
    monthly: "monthly_price",
    quarterly: "quarterly_price",
    half_yearly: "half_yearly_price",
    yearly: "yearly_price",
};
const CYCLE_DAYS = {
    monthly: 30,
    quarterly: 90,
    half_yearly: 180,
    yearly: 365,
};
exports.submitPayment = (0, express_async_handler_1.default)(async (req, res) => {
    const clientId = req.tenantClientId;
    if (!clientId)
        throw new unauthorizedError_1.UnauthorizedError("Tenant not authenticated");
    const client = await Client_1.ClientModel.findById(clientId);
    if (!client)
        throw new NotFound_1.NotFound("Tenant not found");
    const { payment_cycle, screenshot } = req.body || {};
    if (!payment_cycle || !CYCLE_PRICE_FIELD[payment_cycle]) {
        throw new BadRequest_1.BadRequest("Invalid payment_cycle. Use monthly, quarterly, half_yearly, or yearly.");
    }
    const pkg = await Package_1.PackageModel.findById(client.package_id);
    if (!pkg)
        throw new NotFound_1.NotFound("Package not found");
    const priceField = CYCLE_PRICE_FIELD[payment_cycle];
    const amount = pkg[priceField];
    if (typeof amount !== "number")
        throw new BadRequest_1.BadRequest("Package price not configured for this cycle.");
    // Prevent duplicate pending payments
    const existingPending = await Payment_1.PaymentModel.findOne({ client_id: client._id, status: "pending" });
    if (existingPending) {
        return (0, response_1.SuccessResponse)(res, { message: "A payment request is already pending approval.", data: { paymentId: existingPending._id, status: "pending" } }, 200);
    }
    const payment = await Payment_1.PaymentModel.create({
        client_id: client._id,
        package_id: client.package_id,
        amount,
        date: new Date(),
        status: "pending",
        payment_cycle,
        screenshot: screenshot || null,
    });
    return (0, response_1.SuccessResponse)(res, { message: "Payment submitted for approval.", data: { paymentId: payment._id, amount, payment_cycle, status: "pending" } }, 201);
});
exports.paymentStatus = (0, express_async_handler_1.default)(async (req, res) => {
    const clientId = req.tenantClientId;
    if (!clientId)
        throw new unauthorizedError_1.UnauthorizedError("Tenant not authenticated");
    const latest = await Payment_1.PaymentModel.findOne({ client_id: clientId }).sort({ createdAt: -1 });
    if (!latest) {
        return (0, response_1.SuccessResponse)(res, { message: "No payments found.", data: null }, 200);
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Payment status retrieved.",
        data: {
            paymentId: latest._id,
            amount: latest.amount,
            payment_cycle: latest.payment_cycle,
            status: latest.status,
            date: latest.date,
        },
    }, 200);
});
// Super-admin approval helpers (called via admin routes separately) exported for reuse
const approvePaymentById = async (paymentId) => {
    const payment = await Payment_1.PaymentModel.findById(paymentId);
    if (!payment)
        throw new NotFound_1.NotFound("Payment not found");
    if (payment.status !== "pending")
        throw new BadRequest_1.BadRequest("Payment is not pending.");
    const client = await Client_1.ClientModel.findById(payment.client_id);
    if (!client)
        throw new NotFound_1.NotFound("Client not found");
    const cycle = payment.payment_cycle || client.payment_cycle || "monthly";
    const days = CYCLE_DAYS[cycle] || 30;
    const now = new Date();
    const currentEnd = client.subscription_end_date && client.subscription_end_date > now
        ? client.subscription_end_date
        : now;
    const newEnd = new Date(currentEnd.getTime() + days * 24 * 60 * 60 * 1000);
    client.subscription_end_date = newEnd;
    client.status = "active";
    client.payment_cycle = cycle;
    if (payment.amount)
        client.payment_amount = payment.amount;
    await client.save();
    payment.status = "approve";
    await payment.save();
    return { client, payment, newEnd };
};
exports.approvePaymentById = approvePaymentById;
const rejectPaymentById = async (paymentId) => {
    const payment = await Payment_1.PaymentModel.findById(paymentId);
    if (!payment)
        throw new NotFound_1.NotFound("Payment not found");
    if (payment.status !== "pending")
        throw new BadRequest_1.BadRequest("Payment is not pending.");
    payment.status = "reject";
    await payment.save();
    return payment;
};
exports.rejectPaymentById = rejectPaymentById;
