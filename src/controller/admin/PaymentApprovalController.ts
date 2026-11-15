import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { PaymentModel } from "../../models/schema/auth/Payment";
import { ClientModel } from "../../models/schema/auth/Client";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { approvePaymentById, rejectPaymentById } from "../../controller/tenant/TenantPaymentController";

export const listPendingPayments = asyncHandler(async (req: Request, res: Response) => {
  const payments = await PaymentModel.find({ status: "pending" }).sort({ createdAt: -1 }).populate("client_id", "company_name subdomain").populate("package_id", "name");
  return SuccessResponse(res, { message: "Pending payments retrieved.", data: payments }, 200);
});

export const listAllPayments = asyncHandler(async (req: Request, res: Response) => {
  const payments = await PaymentModel.find().sort({ createdAt: -1 }).populate("client_id", "company_name subdomain").populate("package_id", "name");
  return SuccessResponse(res, { message: "Payments retrieved.", data: payments }, 200);
});

export const approvePayment = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await approvePaymentById(id);
  return SuccessResponse(res, { message: "Payment approved and subscription activated.", data: { clientId: result.client._id, newEndDate: result.newEnd } }, 200);
});

export const rejectPayment = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const payment = await rejectPaymentById(id);
  return SuccessResponse(res, { message: "Payment rejected.", data: { paymentId: payment._id } }, 200);
});
