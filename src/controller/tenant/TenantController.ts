import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { ClientModel } from "../../models/schema/auth/Client";
import { NotFound } from "../../Errors/NotFound";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError } from "../../Errors/unauthorizedError";
import { PaymentModel } from "../../models/schema/auth/Payment";
import { resolveSubscription } from "../../utils/subscription.util";

/**
 * GET /api/tenant/verify
 *
 * Called by a client Systego instance to verify its subscription package
 * and check which features (ecommerce, mobile app, etc.) are enabled.
 *
 * Authentication: X-Tenant-Api-Key header (handled by tenantAuth middleware)
 * The middleware attaches req.tenantClientId before this handler runs.
 */
export const verifyTenant = asyncHandler(
  async (req: Request, res: Response) => {
    const clientId = req.tenantClientId;

    if (!clientId) {
      throw new UnauthorizedError("Tenant not authenticated");
    }

    const client = await ClientModel.findById(clientId)
      .select(
        "company_name subdomain status package_id payment_cycle created_at last_payment_date subscription_end_date main_location branches_locations branches_config",
      )
      .populate({
        path: "package_id",
        select:
          "name status haveEcommerce haveMobileApp havePOS haveReports haveStockTake monthly_price quarterly_price half_yearly_price yearly_price branches online_branches",
      });

    if (!client) {
      throw new NotFound("Tenant not found");
    }

    // ✅ احسب الأيام المتبقية
    const lastPayment = await PaymentModel.findOne({
      client_id: client._id,
      status: "approve",
    }).sort({ date: -1 });

    const remaining = resolveSubscription(client, lastPayment?.date);
    const { daysLeft, endDate, expired } = remaining;

    if (!client.subscription_end_date && remaining.endDate) {
      client.subscription_end_date = remaining.endDate;
    }

    // ✅ لو expired، خلي الـ status inactive
    if (expired && client.status === "active") {
      client.status = "inactive";
    }

    if (client.isModified()) {
      await client.save();
    }

    const packageData = client.package_id as any;

    const locked = client.status !== 'active' || expired;

    const responseData = {
      tenant: {
        company_name: client.company_name,
        subdomain: client.subdomain,
        status: client.status,
      },
      subscription: {
        daysLeft,
        endDate,
        expired,
        lastPaymentDate: lastPayment?.date,
        paymentCycle: client.payment_cycle,
      },
      locked,
      features: locked
        ? {
            haveEcommerce: false,
            haveMobileApp: false,
            havePOS: false,
            haveReports: false,
            haveStockTake: false,
            branches: 0,
            online_branches: 0,
          }
        : {
            haveEcommerce: packageData?.haveEcommerce ?? false,
            haveMobileApp: packageData?.haveMobileApp ?? false,
            havePOS: packageData?.havePOS ?? false,
            haveReports: packageData?.haveReports ?? false,
            haveStockTake: packageData?.haveStockTake ?? false,
            // The number of allowed branches comes from the client's package.
            branches: packageData?.branches ?? 0,
            online_branches: packageData?.online_branches ?? 0,
          },
      package: {
        name: packageData?.name ?? null,
        status: packageData?.status ?? false,
        monthly_price: packageData?.monthly_price ?? null,
        quarterly_price: packageData?.quarterly_price ?? null,
        half_yearly_price: packageData?.half_yearly_price ?? null,
        yearly_price: packageData?.yearly_price ?? null,
      },
    };

    return SuccessResponse(
      res,
      {
        message: "Tenant verified successfully",
        ...responseData,
      },
      200,
    );
  },
);
