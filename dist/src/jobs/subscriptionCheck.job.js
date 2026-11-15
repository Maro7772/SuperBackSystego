"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSubscriptionCheckJob = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const Client_1 = require("../models/schema/auth/Client");
const Payment_1 = require("../models/schema/auth/Payment");
const subscription_util_1 = require("../utils/subscription.util");
const startSubscriptionCheckJob = () => {
    // كل يوم الساعة 2 الفجر
    node_cron_1.default.schedule("0 2 * * *", async () => {
        console.log("[Cron] Checking subscriptions...");
        try {
            const clients = await Client_1.ClientModel.find({ status: "active" });
            for (const client of clients) {
                const lastPayment = await Payment_1.PaymentModel.findOne({
                    client_id: client._id,
                    status: "approve",
                }).sort({ date: -1 });
                const remaining = (0, subscription_util_1.resolveSubscription)(client, lastPayment?.date);
                if (!client.subscription_end_date && remaining.endDate) {
                    client.subscription_end_date = remaining.endDate;
                }
                if (remaining.expired) {
                    client.status = "inactive";
                    console.log(`[Cron] Client "${client.company_name}" expired → inactive`);
                }
                await client.save();
            }
            console.log("[Cron] Subscription check done.");
        }
        catch (err) {
            console.error("[Cron] Subscription check failed:", err.message);
        }
    });
    console.log("✅ Subscription check cron job started.");
};
exports.startSubscriptionCheckJob = startSubscriptionCheckJob;
