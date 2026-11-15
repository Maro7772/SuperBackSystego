import { ClientModel } from "../../models/schema/auth/Client";
import asyncHandler from "express-async-handler";
import { NotFound } from "../../Errors/NotFound";
import { SuccessResponse } from "../../utils/response";
import {
  buildSubscriptionPayload,
  resolveSubscription,
} from "../../utils/subscription.util";
import { PaymentModel } from "../../models/schema/auth/Payment";
import { BadRequest } from "../../Errors/BadRequest";
import { readClientBranches, legacyBranchNames } from "../../utils/clientBranches";

/**
 * GET /api/admin/operation-reports
 */

export const getOperationReports = asyncHandler(async (req, res) => {
  const reports = await ClientModel.find()
    .select(
      "company_name status operation_status package_id main_location branches_locations branches_config db_name payment_cycle payment_amount contact_person_name contact_person_phone sales_man_name sales_man_phone notes created_at last_payment_date subscription_end_date subdomain subdomain_url",
    )
    .sort({ created_at: -1 })
    .populate({
      path: "package_id",
    });

  const reportsWithSubscription = await Promise.all(
    reports.map(async (report) => {
      const lastPayment = await PaymentModel.findOne({
        client_id: report._id,
        status: "approve",
      }).sort({ date: -1 });

      return {
        ...report.toObject(),
        subscription: buildSubscriptionPayload(report, lastPayment),
        // Real branches read from the client's own database (not the legacy
        // branches_locations field, which was only filled for some clients).
        existing_branches: await readClientBranches(
          (report as any).db_name,
          report._id,
          legacyBranchNames(report),
        ),
      };
    }),
  );

  return SuccessResponse(
    res,
    {
      message: "Operation reports retrieved successfully",
      data: reportsWithSubscription,
    },
    200,
  );
});

/**
 * GET /api/admin/operation-reports/:id
 */
export const getOperationReportById = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const report = await ClientModel.findById(id)
    .select("-password")
    .populate({
      path: "package_id",
      populate: { path: "extras" },
    });

  if (!report) {
    throw new NotFound("Client report not found");
  }

  const lastPayment = await PaymentModel.findOne({
    client_id: report._id,
    status: "approve",
  }).sort({ date: -1 });

  return SuccessResponse(
    res,
    {
      message: "Operation report details retrieved successfully",
      data: {
        ...report.toObject(),
        subscription: buildSubscriptionPayload(report, lastPayment),
        // Real branches read from the client's own database.
        existing_branches: await readClientBranches(
          (report as any).db_name,
          report._id,
          legacyBranchNames(report),
        ),
      },
    },
    200,
  );
});

/**
 * POST /api/admin/operation-reports/:id/notes
 * إضافة Note جديدة للعميل
 */
export const addNote = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const { text } = req.body;

  if (!text || !text.trim()) {
    res.status(400).json({ success: false, message: "Note text is required" });
    return;
  }

  const client = await ClientModel.findById(id);
  if (!client) {
    throw new NotFound("Client not found");
  }

  client.notes = client.notes || [];
  client.notes.push({
    text: text.trim(),
    created_at: new Date(),
  });

  await client.save();

  return SuccessResponse(
    res,
    { message: "Note added successfully", data: client.notes },
    201,
  );
});

/**
 * DELETE /api/admin/operation-reports/:id/notes/:noteIndex
 * حذف Note معينة
 */
export const deleteNote = asyncHandler(async (req, res) => {
  const { id, noteIndex } = req.params;

  const client = await ClientModel.findById(id);
  if (!client) {
    throw new NotFound("Client not found");
  }

  if (!client.notes || !client.notes[Number(noteIndex)]) {
    throw new NotFound("Note not found");
  }

  client.notes.splice(Number(noteIndex), 1);
  await client.save();

  return SuccessResponse(
    res,
    { message: "Note deleted successfully", data: client.notes },
    200
  );
});

/**
 * PATCH /api/admin/operation-reports/:id/status
 * or PATCH /api/admin/operation-reports/:id
 * Allows super_admin and viewer to update status (active/inactive) and operation_status (Demo, Sales, Data, Delivered)
 */
export const updateOperationReportStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, operation_status } = req.body;

  const updateFields: Record<string, any> = {};
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
    const existing = await ClientModel.findById(id).select(
      "subscription_end_date last_payment_date created_at payment_cycle",
    );
    if (!existing) {
      throw new NotFound("Client not found");
    }
    const lastPayment = await PaymentModel.findOne({
      client_id: existing._id,
      status: "approve",
    }).sort({ date: -1 });
    const { expired } = resolveSubscription(existing, lastPayment?.date);
    if (expired) {
      throw new BadRequest(
        "Subscription has expired. Record a payment or set an end date before activating.",
      );
    }
  }

  const client = await ClientModel.findByIdAndUpdate(
    id,
    { $set: updateFields },
    { new: true, runValidators: true }
  )
    .select("-password")
    .populate("package_id");

  if (!client) {
    throw new NotFound("Client not found");
  }

  return SuccessResponse(
    res,
    { message: "Status updated successfully", data: client },
    200
  );
});

