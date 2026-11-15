"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateOperationReportStatus = exports.deleteNote = exports.addNote = exports.getOperationReportById = exports.getOperationReports = void 0;
const Client_1 = require("../../models/schema/auth/Client");
const express_async_handler_1 = __importDefault(require("express-async-handler"));
const NotFound_1 = require("../../Errors/NotFound");
const response_1 = require("../../utils/response");
const subscription_util_1 = require("../../utils/subscription.util");
const Payment_1 = require("../../models/schema/auth/Payment");
const BadRequest_1 = require("../../Errors/BadRequest");
const clientBranches_1 = require("../../utils/clientBranches");
/**
 * GET /api/admin/operation-reports
 */
exports.getOperationReports = (0, express_async_handler_1.default)(async (req, res) => {
    const reports = await Client_1.ClientModel.find()
        .select("company_name status operation_status package_id main_location branches_locations branches_config db_name payment_cycle payment_amount contact_person_name contact_person_phone sales_man_name sales_man_phone notes created_at last_payment_date subscription_end_date subdomain subdomain_url")
        .sort({ created_at: -1 })
        .populate({
        path: "package_id",
    });
    const reportsWithSubscription = await Promise.all(reports.map(async (report) => {
        const lastPayment = await Payment_1.PaymentModel.findOne({
            client_id: report._id,
            status: "approve",
        }).sort({ date: -1 });
        return {
            ...report.toObject(),
            subscription: (0, subscription_util_1.buildSubscriptionPayload)(report, lastPayment),
            // Real branches read from the client's own database (not the legacy
            // branches_locations field, which was only filled for some clients).
            existing_branches: await (0, clientBranches_1.readClientBranches)(report.db_name, report._id, (0, clientBranches_1.legacyBranchNames)(report)),
        };
    }));
    return (0, response_1.SuccessResponse)(res, {
        message: "Operation reports retrieved successfully",
        data: reportsWithSubscription,
    }, 200);
});
/**
 * GET /api/admin/operation-reports/:id
 */
exports.getOperationReportById = (0, express_async_handler_1.default)(async (req, res) => {
    const id = req.params.id;
    const report = await Client_1.ClientModel.findById(id)
        .select("-password")
        .populate({
        path: "package_id",
        populate: { path: "extras" },
    });
    if (!report) {
        throw new NotFound_1.NotFound("Client report not found");
    }
    const lastPayment = await Payment_1.PaymentModel.findOne({
        client_id: report._id,
        status: "approve",
    }).sort({ date: -1 });
    return (0, response_1.SuccessResponse)(res, {
        message: "Operation report details retrieved successfully",
        data: {
            ...report.toObject(),
            subscription: (0, subscription_util_1.buildSubscriptionPayload)(report, lastPayment),
            // Real branches read from the client's own database.
            existing_branches: await (0, clientBranches_1.readClientBranches)(report.db_name, report._id, (0, clientBranches_1.legacyBranchNames)(report)),
        },
    }, 200);
});
/**
 * POST /api/admin/operation-reports/:id/notes
 * إضافة Note جديدة للعميل
 */
exports.addNote = (0, express_async_handler_1.default)(async (req, res) => {
    const id = req.params.id;
    const { text } = req.body;
    if (!text || !text.trim()) {
        res.status(400).json({ success: false, message: "Note text is required" });
        return;
    }
    const client = await Client_1.ClientModel.findById(id);
    if (!client) {
        throw new NotFound_1.NotFound("Client not found");
    }
    client.notes = client.notes || [];
    client.notes.push({
        text: text.trim(),
        created_at: new Date(),
    });
    await client.save();
    return (0, response_1.SuccessResponse)(res, { message: "Note added successfully", data: client.notes }, 201);
});
/**
 * DELETE /api/admin/operation-reports/:id/notes/:noteIndex
 * حذف Note معينة
 */
exports.deleteNote = (0, express_async_handler_1.default)(async (req, res) => {
    const { id, noteIndex } = req.params;
    const client = await Client_1.ClientModel.findById(id);
    if (!client) {
        throw new NotFound_1.NotFound("Client not found");
    }
    if (!client.notes || !client.notes[Number(noteIndex)]) {
        throw new NotFound_1.NotFound("Note not found");
    }
    client.notes.splice(Number(noteIndex), 1);
    await client.save();
    return (0, response_1.SuccessResponse)(res, { message: "Note deleted successfully", data: client.notes }, 200);
});
/**
 * PATCH /api/admin/operation-reports/:id/status
 * or PATCH /api/admin/operation-reports/:id
 * Allows super_admin and viewer to update status (active/inactive) and operation_status (Demo, Sales, Data, Delivered)
 */
exports.updateOperationReportStatus = (0, express_async_handler_1.default)(async (req, res) => {
    const { id } = req.params;
    const { status, operation_status } = req.body;
    const updateFields = {};
    if (status !== undefined) {
        updateFields.status = status;
    }
    if (operation_status !== undefined) {
        updateFields.operation_status = operation_status;
    }
    if (Object.keys(updateFields).length === 0) {
        res.status(400).json({ success: false, message: "Nothing to update" });
        return;
    }
    if (status === "active") {
        const existing = await Client_1.ClientModel.findById(id).select("subscription_end_date last_payment_date created_at payment_cycle");
        if (!existing) {
            throw new NotFound_1.NotFound("Client not found");
        }
        const lastPayment = await Payment_1.PaymentModel.findOne({
            client_id: existing._id,
            status: "approve",
        }).sort({ date: -1 });
        const { expired } = (0, subscription_util_1.resolveSubscription)(existing, lastPayment?.date);
        if (expired) {
            throw new BadRequest_1.BadRequest("Subscription has expired. Record a payment or set an end date before activating.");
        }
    }
    const client = await Client_1.ClientModel.findByIdAndUpdate(id, { $set: updateFields }, { new: true, runValidators: true })
        .select("-password")
        .populate("package_id");
    if (!client) {
        throw new NotFound_1.NotFound("Client not found");
    }
    return (0, response_1.SuccessResponse)(res, { message: "Status updated successfully", data: client }, 200);
});
