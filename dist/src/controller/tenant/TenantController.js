"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyTenant = void 0;
const express_async_handler_1 = __importDefault(require("express-async-handler"));
const Client_1 = require("../../models/schema/auth/Client");
const NotFound_1 = require("../../Errors/NotFound");
const response_1 = require("../../utils/response");
const unauthorizedError_1 = require("../../Errors/unauthorizedError");
const Payment_1 = require("../../models/schema/auth/Payment");
const subscription_util_1 = require("../../utils/subscription.util");
/**
 * GET /api/tenant/verify
 *
 * Called by a client Systego instance to verify its subscription package
 * and check which features (ecommerce, mobile app, etc.) are enabled.
 *
 * Authentication: X-Tenant-Api-Key header (handled by tenantAuth middleware)
 * The middleware attaches req.tenantClientId before this handler runs.
 */
exports.verifyTenant = (0, express_async_handler_1.default)(async (req, res) => {
    const clientId = req.tenantClientId;
    if (!clientId) {
        throw new unauthorizedError_1.UnauthorizedError("Tenant not authenticated");
    }
    const client = await Client_1.ClientModel.findById(clientId)
        .select("company_name subdomain status package_id payment_cycle created_at last_payment_date subscription_end_date main_location branches_locations branches_config")
        .populate({
        path: "package_id",
        select: "name status haveEcommerce haveMobileApp havePOS haveReports haveStockTake monthly_price quarterly_price half_yearly_price yearly_price branches online_branches",
    });
    if (!client) {
        throw new NotFound_1.NotFound("Tenant not found");
    }
    // ✅ احسب الأيام المتبقية
    const lastPayment = await Payment_1.PaymentModel.findOne({
        client_id: client._id,
        status: "approve",
    }).sort({ date: -1 });
    const remaining = (0, subscription_util_1.resolveSubscription)(client, lastPayment?.date);
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
    const packageData = client.package_id;
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
    return (0, response_1.SuccessResponse)(res, {
        message: "Tenant verified successfully",
        ...responseData,
    }, 200);
});
