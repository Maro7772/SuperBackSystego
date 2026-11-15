import cron from "node-cron";
import { ClientModel } from "../models/schema/auth/Client";
import { PaymentModel } from "../models/schema/auth/Payment";
import { resolveSubscription } from "../utils/subscription.util";

export const startSubscriptionCheckJob = () => {
  // كل يوم الساعة 2 الفجر
  cron.schedule("0 2 * * *", async () => {
    console.log("[Cron] Checking subscriptions...");

    try {
      const clients = await ClientModel.find({ status: "active" });

      for (const client of clients) {
        const lastPayment = await PaymentModel.findOne({
          client_id: client._id,
          status: "approve",
        }).sort({ date: -1 });

        const remaining = resolveSubscription(client, lastPayment?.date);

        if (!client.subscription_end_date && remaining.endDate) {
          client.subscription_end_date = remaining.endDate;
        }

        if (remaining.expired) {
          client.status = "inactive";
          console.log(
            `[Cron] Client "${client.company_name}" expired → inactive`,
          );
        }

        await client.save();
      }

      console.log("[Cron] Subscription check done.");
    } catch (err: any) {
      console.error("[Cron] Subscription check failed:", err.message);
    }
  });

  console.log("✅ Subscription check cron job started.");
};
