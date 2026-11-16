import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import crypto from "crypto";

// Load environment variables
dotenv.config();

import { ClientModel } from "../models/schema/auth/Client";
import { TenantApiKeyModel } from "../models/schema/auth/TenantApiKey";
import { provisionNewClient } from "../utils/ClientProvisioner";
import { sanitizeSubdomainName } from "../utils/PleskService";

async function run() {
  const clientId = process.argv[2];
  if (!clientId) {
    console.error("[Runner] Error: No clientId provided");
    process.exit(1);
  }

  console.log(`[Runner] Starting detached provisioning for client: ${clientId}`);

  const mongoUri = process.env.MongoDB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("[Runner] Error: MongoDB_URI is not set in environment");
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);
    console.log("[Runner] Connected to MongoDB");

    const client = await ClientModel.findById(clientId);
    if (!client) {
      console.error(`[Runner] Error: Client ${clientId} not found`);
      process.exit(1);
    }

    if (!client.subdomain) {
      console.error(`[Runner] Error: Client ${clientId} has no subdomain`);
      process.exit(1);
    }

    const sanitizedSubdomain = sanitizeSubdomainName(client.subdomain);
    const dbName = client.db_name || `sc_${client._id}`;

    // Mark in progress
    await ClientModel.findByIdAndUpdate(clientId, {
      provisioning_status: "in_progress",
      provisioning_error: undefined,
    });

    // 1. Get raw API key passed from caller (argv[3])
    let rawApiKey = process.argv[3];

    // 2. If no valid rawApiKey passed, generate a new cryptographic key
    if (!rawApiKey || !rawApiKey.startsWith("sk_")) {
      rawApiKey = `sk_${crypto.randomUUID()}_${crypto.randomBytes(16).toString("hex")}`;
      const hashedKey = crypto.createHash("sha256").update(rawApiKey).digest("hex");

      // Deactivate any old keys and insert the new active key
      await TenantApiKeyModel.updateMany(
        { client_id: client._id, active: true },
        { $set: { active: false } },
      );

      await TenantApiKeyModel.create({
        client_id: client._id,
        hashedKey,
        label: "provisioned",
        active: true,
      });

      console.log(`[Runner] Generated and registered new active API key for client: ${client.company_name}`);
    } else {
      // If rawApiKey was provided, ensure it is registered in TenantApiKeyModel
      const hashedKey = crypto.createHash("sha256").update(rawApiKey).digest("hex");
      const existing = await TenantApiKeyModel.findOne({ hashedKey, active: true });
      if (!existing) {
        await TenantApiKeyModel.updateMany(
          { client_id: client._id, active: true },
          { $set: { active: false } },
        );
        await TenantApiKeyModel.create({
          client_id: client._id,
          hashedKey,
          label: "provisioned",
          active: true,
        });
        console.log(`[Runner] Registered provided API key in DB for client: ${client.company_name}`);
      }
    }

    const provisionResult = await provisionNewClient(
      sanitizedSubdomain,
      {
        dbName,
        dbUser: process.env.MONGO_USER || "admin",
        dbPass: encodeURIComponent(process.env.MONGO_PASS || "MONGO@3030"),
      },
      client.logoBase64,
      rawApiKey,
    );

    await ClientModel.findByIdAndUpdate(clientId, {
      provisioning_status: "completed",
      subdomain_url: provisionResult.frontendUrl,
      provisioning_error: undefined,
    });

    console.log(`[Runner] ✅ Provisioning completed successfully for client: ${client.company_name} (${sanitizedSubdomain})`);
  } catch (error: any) {
    console.error(`[Runner] ❌ Provisioning failed for client ${clientId}:`, error.message);
    try {
      await ClientModel.findByIdAndUpdate(clientId, {
        provisioning_status: "failed",
        provisioning_error: error.message || String(error),
      });
    } catch (dbErr) {
      console.error("[Runner] Could not record provisioning failure in database:", dbErr);
    }
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
