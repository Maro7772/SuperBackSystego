import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

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

    // Fetch tenant API key
    const apiKeyDoc = await TenantApiKeyModel.findOne({
      client_id: client._id,
      active: true,
    });

    const provisionResult = await provisionNewClient(
      sanitizedSubdomain,
      {
        dbName,
        dbUser: process.env.MONGO_USER || "admin",
        dbPass: encodeURIComponent(process.env.MONGO_PASS || "MONGO@3030"),
      },
      client.logoBase64,
      apiKeyDoc ? apiKeyDoc.label : undefined,
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
