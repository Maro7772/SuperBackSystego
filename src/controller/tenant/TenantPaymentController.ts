import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { ClientModel } from "../../models/schema/auth/Client";
import { PackageModel } from "../../models/schema/auth/Package";
import { PaymentModel } from "../../models/schema/auth/Payment";
import { NotFound } from "../../Errors/NotFound";
import { UnauthorizedError } from "../../Errors/unauthorizedError";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";

const CYCLE_PRICE_FIELD: Record<string, string> = {
  monthly: "monthly_price",
  quarterly: "quarterly_price",
  half_yearly: "half_yearly_price",
  yearly: "yearly_price",
};

const CYCLE_DAYS: Record<string, number> = {
  monthly: 30,
  quarterly: 90,
  half_yearly: 180,
  yearly: 365,
};

export const submitPayment = asyncHandler(async (req: Request, res: Response) => {
  const clientId = req.tenantClientId;
  if (!clientId) throw new UnauthorizedError("Tenant not authenticated");

  const client = await ClientModel.findById(clientId);
  if (!client) throw new NotFound("Tenant not found");

  const { payment_cycle, screenshot } = req.body || {};
  if (!payment_cycle || !CYCLE_PRICE_FIELD[payment_cycle]) {
    throw new BadRequest("Invalid payment_cycle. Use monthly, quarterly, half_yearly, or yearly.");
  }

  const pkg = await PackageModel.findById(client.package_id);
  if (!pkg) throw new NotFound("Package not found");

  const priceField = CYCLE_PRICE_FIELD[payment_cycle];
  const amount = (pkg as any)[priceField];
  if (typeof amount !== "number") throw new BadRequest("Package price not configured for this cycle.");

  // Prevent duplicate pending payments
  const existingPending = await PaymentModel.findOne({ client_id: client._id, status: "pending" });
  if (existingPending) {
    return SuccessResponse(res, { message: "A payment request is already pending approval.", data: { paymentId: existingPending._id, status: "pending" } }, 200);
  }

  const payment = await PaymentModel.create({
    client_id: client._id,
    package_id: client.package_id,
    amount,
    date: new Date(),
    status: "pending",
    payment_cycle,
    screenshot: screenshot || null,
  });

  return SuccessResponse(res, { message: "Payment submitted for approval.", data: { paymentId: payment._id, amount, payment_cycle, status: "pending" } }, 201);
});

export const paymentStatus = asyncHandler(async (req: Request, res: Response) => {
  const clientId = req.tenantClientId;
  if (!clientId) throw new UnauthorizedError("Tenant not authenticated");

  const latest = await PaymentModel.findOne({ client_id: clientId }).sort({ createdAt: -1 });
  if (!latest) {
    return SuccessResponse(res, { message: "No payments found.", data: null }, 200);
  }

  return SuccessResponse(res, {
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
export const approvePaymentById = async (paymentId: string) => {
  const payment = await PaymentModel.findById(paymentId);
  if (!payment) throw new NotFound("Payment not found");
  if (payment.status !== "pending") throw new BadRequest("Payment is not pending.");

  const client = await ClientModel.findById(payment.client_id);
  if (!client) throw new NotFound("Client not found");

  const cycle = payment.payment_cycle || client.payment_cycle || "monthly";
  const days = CYCLE_DAYS[cycle] || 30;

  const now = new Date();
  const currentEnd = client.subscription_end_date && client.subscription_end_date > now
    ? client.subscription_end_date
    : now;
  const newEnd = new Date(currentEnd.getTime() + days * 24 * 60 * 60 * 1000);

  client.subscription_end_date = newEnd;
  client.status = "active";
  client.payment_cycle = cycle as any;
  if (payment.amount) client.payment_amount = payment.amount;
  await client.save();

  payment.status = "approve";
  await payment.save();

  return { client, payment, newEnd };
};

export const rejectPaymentById = async (paymentId: string) => {
  const payment = await PaymentModel.findById(paymentId);
  if (!payment) throw new NotFound("Payment not found");
  if (payment.status !== "pending") throw new BadRequest("Payment is not pending.");
  payment.status = "reject";
  await payment.save();
  return payment;
};
