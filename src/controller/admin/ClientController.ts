import { ClientModel } from "../../models/schema/auth/Client";
import mongoose from "mongoose";
import asyncHandler from "express-async-handler";
import path from "path";
import { NotFound } from "../../Errors/NotFound";
import { SuccessResponse } from "../../utils/response";
import { PackageModel } from "../../models/schema/auth/Package";
import { UniqueConstrainError } from "../../Errors";
import crypto from "crypto";
import { seedTenantCashierRole } from "../../utils/seedTenantRoles";
import {
  deleteSubdomain,
  sanitizeSubdomainName,
  validateSubdomainName,
} from "../../utils/PleskService";
import {
  provisionNewClient,
  rebuildFrontendForClient,
  deployBackendForClient,
  generateBackendEnv,
  getPleskSystemUser,
} from "../../utils/ClientProvisioner";
import { executePleskCli } from "../../utils/PleskService";
import { TenantApiKeyModel } from "../../models/schema/auth/TenantApiKey";
import {
  addCycleDays,
  buildSubscriptionPayload,
  endOfDay,
  extendSubscriptionEnd,
  remainingFromEndDate,
  resolveSubscription,
} from "../../utils/subscription.util";
import { PaymentModel } from "../../models/schema/auth/Payment";
import { BadRequest } from "../../Errors/BadRequest";
import { readClientBranches, legacyBranchNames } from "../../utils/clientBranches";

export const getAllClients = asyncHandler(async (req, res) => {
  const clients = await ClientModel.find()
    .select("-password -logoBase64 -admin_password")
    .sort({ created_at: -1 })
    .populate({
      path: "package_id",
      select: "name price features",
    });

  const clientsWithSubscription = await Promise.all(
    clients.map(async (client) => {
      const lastPayment = await PaymentModel.findOne({
        client_id: client._id,
        status: "approve",
      }).sort({ date: -1 });

      return {
        ...client.toObject(),
        subscription: buildSubscriptionPayload(client, lastPayment),
      };
    }),
  );

  return SuccessResponse(
    res,
    {
      message: "Clients retrieved successfully",
      data: clientsWithSubscription,
    },
    200,
  );
});

export const getClientById = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const client = await ClientModel.findOne({ _id: id })
    .select("-password")
    .populate("package_id");

  if (!client) {
    throw new NotFound("Client not found");
  }

  const lastPayment = await PaymentModel.findOne({
    client_id: client._id,
    status: "approve",
  }).sort({ date: -1 });

  const clientResponse = client.toObject() as any;
  clientResponse.subscription = buildSubscriptionPayload(client, lastPayment);

  // Read the branches that actually exist in the client's own admin, so the
  // owner can see what is already there (including legacy branches).
  clientResponse.existing_branches = await readClientBranches(
    client.db_name,
    client._id,
    legacyBranchNames(client),
  );

  return SuccessResponse(
    res,
    { message: "Client retrieved successfully", data: clientResponse },
    200,
  );
});

export const createClient = asyncHandler(async (req, res) => {
  const {
    company_name,
    email,
    password,
    status,
    package_id,
    subdomain,
    logoBase64,
    main_location,
    branches_locations,
    branches_config,
    payment_cycle,
    payment_amount,
    contact_person_name,
    contact_person_phone,
    sales_man_name,
    sales_man_phone,
    subscription_end_date,
  } = req.body;

  const existingPackage = await PackageModel.findById(package_id);
  if (!existingPackage) {
    throw new NotFound("Package not found");
  }

  const existingClient = await ClientModel.findOne({ email });
  if (existingClient) {
    throw new UniqueConstrainError("Client with this email already exists");
  }

  const validationError = validateSubdomainName(subdomain);
  if (validationError) {
    throw new UniqueConstrainError(validationError);
  }

  const sanitizedSubdomain = sanitizeSubdomainName(subdomain);

  const existingSubdomain = await ClientModel.findOne({
    subdomain: sanitizedSubdomain,
  });
  if (existingSubdomain) {
    throw new UniqueConstrainError(
      `Subdomain "${sanitizedSubdomain}.systego.net" is already taken`,
    );
  }

  const now = new Date();
  const cycle = payment_cycle || "monthly";
  const computedEnd = subscription_end_date
    ? endOfDay(subscription_end_date)
    : addCycleDays(now, cycle);

  const client = await ClientModel.create({
    company_name,
    email,
    password,
    status,
    package_id,
    subdomain: sanitizedSubdomain,
    logoBase64,
    main_location,
    branches_locations,
    branches_config,
    payment_cycle: cycle,
    payment_amount,
    contact_person_name,
    contact_person_phone,
    sales_man_name,
    sales_man_phone,
    last_payment_date: now,
    subscription_end_date: computedEnd,
  });

  const dbName = `sc_${client._id}`;

  try {
    const newDbConnection = mongoose.connection.useDb(dbName, {
      useCache: true,
    });

    await newDbConnection.createCollection("metadata");
    await newDbConnection.collection("metadata").insertOne({
      created_at: new Date(),
      client_id: client._id,
      company_name: client.company_name,
    });

    const targetCollection = "users";
    await newDbConnection.createCollection(targetCollection);

    let initialPasswordHash = password;
    try {
      const bcrypt = require("bcryptjs");
      const salt = await bcrypt.genSalt(10);
      initialPasswordHash = await bcrypt.hash(password, salt);
    } catch (e) {
      console.warn("Could not hash password for initial seed", e);
    }

    await newDbConnection.collection(targetCollection).insertOne({
      username: "admin",
      email: email,
      password_hash: initialPasswordHash,
      company_name: company_name,
      phone: "0000000000",
      role: "superadmin",
      status: "active",
      permissions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(
      `Database ${dbName} created and seeded with compliant superadmin`,
    );

    // Seed default Cashier role for the tenant
    await seedTenantCashierRole(newDbConnection);
  } catch (error: any) {
    console.error("Failed to create client database:", error);
    try {
      const dropDb = mongoose.connection.useDb(dbName, { useCache: false });
      await dropDb.dropDatabase();
    } catch (dropErr) {
      console.warn(`Could not drop database ${dbName} during rollback:`, dropErr);
    }
    await ClientModel.findByIdAndDelete(client._id);
    throw new Error(
      `Failed to create client database: ${error.message || error}. Client creation rolled back.`,
    );
  }

  // Generate tenant API key BEFORE provisioning so it can be written into the
  // client backend .env (avoids NOT_SET / cross-client key leakage).
  let rawApiKey: string | undefined;
  try {
    rawApiKey = `sk_${crypto.randomUUID()}_${crypto.randomBytes(16).toString("hex")}`;
    const hashedKey = crypto
      .createHash("sha256")
      .update(rawApiKey)
      .digest("hex");

    await TenantApiKeyModel.create({
      client_id: client._id,
      hashedKey,
      label: "default",
      active: true,
    });

    console.log(
      `[Provisioning] Tenant API key generated for client: ${client.company_name}`,
    );
  } catch (apiKeyError: any) {
    console.error("Failed to generate tenant API key:", apiKeyError.message);
  }

  const parentDomain = process.env.PLESK_PARENT_DOMAIN || "systego.net";
  const expectedFrontendUrl = `https://${sanitizedSubdomain}.${parentDomain}`;

  client.db_name = dbName;
  client.subdomain_url = expectedFrontendUrl;
  client.provisioning_status = "in_progress";
  await client.save();

  // Spawn detached provisioning process that survives Passenger web worker reloads!
  const runnerScript = path.resolve(__dirname, "../../scripts/provisionClientRunner.js");
  try {
    const { spawn } = require("child_process");
    const child = spawn(process.execPath, [runnerScript, client._id.toString(), rawApiKey || ""], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    console.log(
      `[Provisioning] Detached background runner spawned with PID ${child.pid} for client ${client.company_name} (${client._id})`,
    );
  } catch (spawnError: any) {
    console.error(
      `[Provisioning] Failed to spawn detached runner, falling back to setImmediate:`,
      spawnError.message,
    );
    setImmediate(async () => {
      try {
        const provisionResult = await provisionNewClient(
          sanitizedSubdomain,
          {
            dbName: dbName,
            dbUser: process.env.MONGO_USER || "admin",
            dbPass: encodeURIComponent(process.env.MONGO_PASS || "MONGO@3030"),
          },
          logoBase64,
          rawApiKey,
        );
        await ClientModel.findByIdAndUpdate(client._id, {
          provisioning_status: "completed",
          subdomain_url: provisionResult.frontendUrl,
        });
      } catch (err: any) {
        await ClientModel.findByIdAndUpdate(client._id, {
          provisioning_status: "failed",
          provisioning_error: err.message || String(err),
        });
      }
    });
  }

  const clientResponse = client.toObject() as any;
  delete clientResponse.admin_password;
  delete clientResponse.password;
  clientResponse.db_name = dbName;
  clientResponse.subdomain_url = expectedFrontendUrl;

  return SuccessResponse(
    res,
    {
      message:
        "Client created successfully. Subdomain and backend deployment are running in the background.",
      data: clientResponse,
    },
    201,
  );
});

// ============================================================
// âœ… UPDATE CLIENT â€” Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ù…Ø¹Ø¯Ù„Ø©
// ============================================================
export const updateClient = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const updateData = { ...req.body };

  // Prevent subdomain changes
  if (updateData.subdomain || updateData.subdomain_url) {
    delete updateData.subdomain;
    delete updateData.subdomain_url;
  }

  if (
    updateData.subscription_end_date === "" ||
    updateData.subscription_end_date === null
  ) {
    delete updateData.subscription_end_date;
  } else if (updateData.subscription_end_date) {
    updateData.subscription_end_date = endOfDay(updateData.subscription_end_date);
  }

  const existingClient = await ClientModel.findById(id);
  if (!existingClient) {
    throw new NotFound("Client not found");
  }

  if (updateData.status === "active" && !updateData.subscription_end_date) {
    const lastPayment = await PaymentModel.findOne({
      client_id: existingClient._id,
      status: "approve",
    }).sort({ date: -1 });
    const { expired } = resolveSubscription(existingClient, lastPayment?.date);
    if (expired) {
      throw new BadRequest(
        "Subscription has expired. Record a payment or set an end date before activating.",
      );
    }
  }

  // Only derive the status from the (new) subscription end date when the
  // caller did not explicitly send one. An explicit status — e.g. the owner
  // setting a client to "inactive" — must always win, otherwise it was being
  // silently forced back to "active".
  if (updateData.subscription_end_date && updateData.status === undefined) {
    const { expired } = remainingFromEndDate(updateData.subscription_end_date);
    updateData.status = expired ? "inactive" : "active";
  }

  // âœ… Ø´ÙˆÙ Ù„Ùˆ Ø§Ù„Ø¨Ø§Ø³ÙˆØ±Ø¯ Ø¬Ø§ÙŠ Ø¬Ø¯ÙŠØ¯
  const newPassword =
    updateData.password && updateData.password.trim() !== ""
      ? updateData.password
      : null;

  // âœ… Ù„Ùˆ Ø§Ù„Ø¨Ø§Ø³ÙˆØ±Ø¯ ÙØ§Ø¶ÙŠØŒ Ø§Ù…Ø³Ø­Ù‡ Ø¹Ø´Ø§Ù† Ù…ÙŠØªØºÙŠØ±Ø´ ÙÙŠ ClientModel
  if (!newPassword) {
    delete updateData.password;
  }

  let logoBase64 = null;
  if (updateData.logoBase64) {
    logoBase64 = updateData.logoBase64;
  }

  const client = await ClientModel.findOneAndUpdate({ _id: id }, updateData, {
    new: true,
    runValidators: true,
  })
    .select("-password")
    .populate("package_id");

  if (!client) {
    throw new NotFound("Client not found");
  }

  // âœ…âœ…âœ… Ù„Ùˆ Ø§Ù„Ø¨Ø§Ø³ÙˆØ±Ø¯ Ø§ØªØºÙŠØ±ØŒ Ù†Ø­Ø¯Ø«Ù‡ ÙƒÙ…Ø§Ù† ÙÙŠ Ø§Ù„Ù€ DB Ø¨ØªØ§Ø¹Ø© Ø§Ù„Ø¹Ù…ÙŠÙ„
  if (newPassword && client.db_name) {
    try {
      const bcrypt = require("bcryptjs");
      const salt = await bcrypt.genSalt(10);
      const newPasswordHash = await bcrypt.hash(newPassword, salt);

      const clientDb = mongoose.connection.useDb(client.db_name, {
        useCache: true,
      });

      const result = await clientDb.collection("users").updateOne(
        { username: "admin" },
        {
          $set: {
            password_hash: newPasswordHash,
            updatedAt: new Date(),
          },
        },
      );

      console.log(
        `[updateClient] Password synced to client DB "${client.db_name}" â€” matched: ${result.matchedCount}, modified: ${result.modifiedCount}`,
      );
    } catch (err: any) {
      console.error(
        `[updateClient] Failed to sync password to client DB: ${err.message}`,
      );
      // âš ï¸ Ù…Ù…ÙƒÙ† ØªØ®ØªØ§Ø± ØªØ±Ù…ÙŠ Error Ø£Ùˆ ØªÙƒÙ…Ù„. Ø£Ù†Ø§ Ù‡ÙƒÙ…Ù„ Ø¹Ø´Ø§Ù† Ù…ØªØ¹Ø±Ù‚Ù„Ø´ Ø§Ù„ØªØ¹Ø¯ÙŠÙ„
    }
  }

  if (logoBase64 && client.subdomain) {
    const { updateClientLogo } = require("../../utils/ClientProvisioner");
    await updateClientLogo(client.subdomain, logoBase64);
  }

  return SuccessResponse(
    res,
    { message: "Client updated successfully", data: client },
    200,
  );
});

export const deleteClient = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const client = await ClientModel.findById(id);

  if (!client) {
    throw new NotFound("Client not found");
  }

  if (client.subdomain) {
    try {
      await deleteSubdomain(client.subdomain);
      console.log(
        `Frontend subdomain ${client.subdomain_url} deleted from Plesk`,
      );

      const backendSubdomain = `api-${client.subdomain}`;
      await deleteSubdomain(backendSubdomain);
      console.log(
        `Backend subdomain ${backendSubdomain}.systego.net deleted from Plesk`,
      );
    } catch (error: any) {
      console.error("Failed to delete subdomains from Plesk:", error.message);
    }
  }

  if (client.db_name) {
    try {
      await mongoose.connection
        .useDb(client.db_name, { useCache: true })
        .dropDatabase();
      console.log(`Database ${client.db_name} dropped`);
    } catch (error) {
      console.error("Failed to drop client database:", error);
    }
  }

  await ClientModel.findByIdAndDelete(id);

  return SuccessResponse(res, { message: "Client deleted successfully" }, 200);
});

export const getClientsByStatus = asyncHandler(async (req, res) => {
  const { status } = req.params;
  const clients = await ClientModel.find({ status })
    .sort({ created_at: -1 })
    .populate("package_id");

  return SuccessResponse(
    res,
    {
      message: `Clients with status ${status} retrieved successfully`,
      data: clients,
    },
    200,
  );
});

export const rebuildClientFrontend = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const client = await ClientModel.findById(id);

  if (!client) {
    throw new NotFound("Client not found");
  }

  if (!client.subdomain) {
    res
      .status(400)
      .json({ success: false, message: "Client has no subdomain" });
    return;
  }

  try {
    await rebuildFrontendForClient(client.subdomain);
    return SuccessResponse(
      res,
      { message: "Frontend rebuilt successfully" },
      200,
    );
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to rebuild frontend",
      error: error.message,
    });
  }
});

export const deployClientBackend = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const client = await ClientModel.findById(id);

  if (!client) {
    throw new NotFound("Client not found");
  }

  if (!client.subdomain) {
    res
      .status(400)
      .json({ success: false, message: "Client has no subdomain" });
    return;
  }
  try {
    const path = require("path");
    const PLESK_VHOSTS_DIR =
      process.env.PLESK_VHOSTS_DIR || "/var/www/vhosts/systego.net/subdomains";
    const backendDestDir = path.join(
      PLESK_VHOSTS_DIR,
      `api-${client.subdomain}`,
    );
    const backendSubdomainUrl = `api-${client.subdomain}.systego.net`;

    await deployBackendForClient(
      client.subdomain,
      backendSubdomainUrl,
      backendDestDir,
    );
    return SuccessResponse(
      res,
      {
        message:
          "Backend Node.js application deployed and restarted successfully",
      },
      200,
    );
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to deploy backend on Plesk",
      error: error.message,
    });
  }
});

export const regenerateClientEnv = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const client = await ClientModel.findById(id);

  if (!client) {
    throw new NotFound("Client not found");
  }

  if (!client.subdomain) {
    res
      .status(400)
      .json({ success: false, message: "Client has no subdomain" });
    return;
  }

  try {
    const path = require("path");
    const PLESK_VHOSTS_DIR =
      process.env.PLESK_VHOSTS_DIR || "/var/www/vhosts/systego.net/subdomains";
    const backendDestDir = path.join(
      PLESK_VHOSTS_DIR,
      `api-${client.subdomain}`,
    );
    const frontendUrl = `${client.subdomain}.systego.net`;
    const dbName = `sc_${client._id}`;

    await generateBackendEnv(backendDestDir, client.subdomain, frontendUrl, {
      dbName,
      dbUser: process.env.MONGO_USER || "admin",
      dbPass: encodeURIComponent(process.env.MONGO_PASS || "MONGO@3030"),
    });

    const apiSubdomain = `api-${client.subdomain}.systego.net`;
    await executePleskCli("extension", [
      "--call",
      "nodejs",
      "--disable",
      "-domain",
      apiSubdomain,
    ]);
    await executePleskCli("extension", [
      "--call",
      "nodejs",
      "--enable",
      "-domain",
      apiSubdomain,
    ]);

    return SuccessResponse(
      res,
      { message: "Backend .env regenerated and app restarted successfully" },
      200,
    );
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to regenerate .env",
      error: error.message,
    });
  }
});

export const select = asyncHandler(async (req, res) => {
  const packages = await PackageModel.find()
    .select("name")
    .sort({ created_at: -1 });

  return SuccessResponse(
    res,
    { message: "Packages retrieved successfully", data: packages },
    200,
  );
});

export const installClientSsl = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const client = await ClientModel.findById(id);

  if (!client || !client.subdomain) {
    throw new NotFound("Client or subdomain not found");
  }

  const frontendSubdomainUrl = `${client.subdomain}.systego.net`;
  const backendSubdomainUrl = `api-${client.subdomain}.systego.net`;

  console.log(
    `[SSL API] Starting SSL installation for client: ${client.company_name}`,
  );

  try {
    const { executePleskCli } = require("../../utils/PleskService");
    const adminEmail = process.env.SSL_ADMIN_EMAIL || "systego.eg@gmail.com";

    console.log(
      `[SSL API] Waiting 10 seconds for Web Server configuration to reload...`,
    );
    const { setTimeout } = require("timers/promises");
    await setTimeout(10000);

    console.log(
      `[SSL API] Installing Let's Encrypt SSL for ${frontendSubdomainUrl}...`,
    );
    await executePleskCli("extension", [
      "--exec",
      "letsencrypt",
      "cli.php",
      "-d",
      frontendSubdomainUrl,
      "-m",
      adminEmail,
    ]);

    console.log(
      `[SSL API] Installing Let's Encrypt SSL for ${backendSubdomainUrl}...`,
    );
    await executePleskCli("extension", [
      "--exec",
      "letsencrypt",
      "cli.php",
      "-d",
      backendSubdomainUrl,
      "-m",
      adminEmail,
    ]);

    SuccessResponse(
      res,
      { message: "SSL certificates successfully installed" },
      200,
    );
  } catch (error: any) {
    console.error("[SSL API] Failed to install SSL:", error);
    res.status(500).json({
      success: false,
      message: `Failed to install SSL certificates: ${error.message}`,
    });
  }
});

export const viewSelection = asyncHandler(async (req, res) => {
  const packages = await PackageModel.find();

  return SuccessResponse(
    res,
    { message: "Packages retrieved successfully", data: packages },
    200,
  );
});

export const regenerateApiKey = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const client = await ClientModel.findById(id);

  if (!client) {
    throw new NotFound("Client not found");
  }

  await TenantApiKeyModel.updateMany(
    { client_id: client._id, active: true },
    { $set: { active: false } },
  );

  const rawApiKey = `sk_${crypto.randomUUID()}_${crypto.randomBytes(16).toString("hex")}`;
  const hashedKey = crypto.createHash("sha256").update(rawApiKey).digest("hex");

  await TenantApiKeyModel.create({
    client_id: client._id,
    hashedKey,
    label: "regenerated",
    active: true,
  });

  // Send the response immediately so the frontend gets the key without waiting
  // for the (potentially slow) Plesk .env update / app restart.
  SuccessResponse(
    res,
    {
      message:
        "API key regenerated successfully. Store this key securely - it will not be shown again.",
      data: { apiKey: rawApiKey },
    },
    200,
  );

  // Best-effort: update the client backend .env and restart the app in the
  // background. Failures are logged but never block the response.
  if (client.subdomain && rawApiKey) {
    (async () => {
      try {
        const path = require("path");
        const PLESK_VHOSTS_DIR =
          process.env.PLESK_VHOSTS_DIR ||
          "/var/www/vhosts/systego.net/subdomains";
        const backendDestDir = path.join(
          PLESK_VHOSTS_DIR,
          `api-${client.subdomain}`,
        );
        const frontendUrl = `${client.subdomain}.systego.net`;
        const dbName = client.db_name || `sc_${client._id}`;

        await generateBackendEnv(
          backendDestDir,
          client.subdomain as string,
          frontendUrl,
          {
            dbName,
            dbUser: process.env.MONGO_USER || "admin",
            dbPass: encodeURIComponent(process.env.MONGO_PASS || "MONGO@3030"),
          },
          rawApiKey as string,
        );

        const apiSubdomain = `api-${client.subdomain as string}.systego.net`;
        await executePleskCli("extension", [
          "--call",
          "nodejs",
          "--disable",
          "-domain",
          apiSubdomain,
        ]);
        await executePleskCli("extension", [
          "--call",
          "nodejs",
          "--enable",
          "-domain",
          apiSubdomain,
        ]);

        console.log(
          `[API Key] Updated .env and restarted backend for ${client.company_name}`,
        );
      } catch (envError: any) {
        console.error(
          `[API Key] Failed to update .env on server: ${envError.message}`,
        );
      }
    })();
  }
});

export const generateApiKeysForExistingClients = asyncHandler(
  async (req, res) => {
    const { updateEnv } = req.body;

    const allClients = await ClientModel.find().select(
      "_id company_name subdomain db_name",
    );

    const existingKeys = await TenantApiKeyModel.find({ active: true }).select(
      "client_id",
    );
    const clientsWithKeys = new Set(
      existingKeys.map((k) => k.client_id.toString()),
    );

    const clientsNeedingKeys = allClients.filter(
      (c) => !clientsWithKeys.has(c._id.toString()),
    );

    if (clientsNeedingKeys.length === 0) {
      return SuccessResponse(
        res,
        {
          message:
            "All clients already have active API keys. No action needed.",
          data: { generated: 0 },
        },
        200,
      );
    }

    const results: Array<{
      clientId: string;
      companyName: string | undefined;
      subdomain: string | undefined;
      apiKey: string;
      envUpdated: boolean;
    }> = [];

    for (const client of clientsNeedingKeys) {
      const rawApiKey = `sk_${crypto.randomUUID()}_${crypto.randomBytes(16).toString("hex")}`;
      const hashedKey = crypto
        .createHash("sha256")
        .update(rawApiKey)
        .digest("hex");

      await TenantApiKeyModel.create({
        client_id: client._id,
        hashedKey,
        label: "migration",
        active: true,
      });

      let envUpdated = false;

      if (updateEnv && client.subdomain) {
        try {
          const path = require("path");
          const PLESK_VHOSTS_DIR =
            process.env.PLESK_VHOSTS_DIR ||
            "/var/www/vhosts/systego.net/subdomains";
          const backendDestDir = path.join(
            PLESK_VHOSTS_DIR,
            `api-${client.subdomain}`,
          );
          const frontendUrl = `${client.subdomain}.systego.net`;
          const dbName = client.db_name || `sc_${client._id}`;

          await generateBackendEnv(
            backendDestDir,
            client.subdomain,
            frontendUrl,
            {
              dbName,
              dbUser: process.env.MONGO_USER || "admin",
              dbPass: encodeURIComponent(
                process.env.MONGO_PASS || "MONGO@3030",
              ),
            },
            rawApiKey,
          );

          const apiSubdomain = `api-${client.subdomain as string}.systego.net`;
          await executePleskCli("extension", [
            "--call",
            "nodejs",
            "--disable",
            "-domain",
            apiSubdomain,
          ]);
          await executePleskCli("extension", [
            "--call",
            "nodejs",
            "--enable",
            "-domain",
            apiSubdomain,
          ]);

          envUpdated = true;
        } catch (err: any) {
          console.error(
            `[Migration] Failed to update .env for ${client.company_name}: ${err.message}`,
          );
        }
      }

      results.push({
        clientId: client._id.toString(),
        companyName: client.company_name,
        subdomain: client.subdomain,
        apiKey: rawApiKey,
        envUpdated,
      });

      console.log(
        `[Migration] Generated API key for ${client.company_name} (${client.subdomain})`,
      );
    }

    return SuccessResponse(
      res,
      {
        message: `Generated API keys for ${results.length} existing clients. Store these keys securely â€” they will not be shown again!`,
        data: { generated: results.length, clients: results },
      },
      200,
    );
  },
);

export const renewClientSubscription = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const { amount, note } = req.body || {};

  const client = await ClientModel.findById(id);
  if (!client) {
    throw new NotFound("Client not found");
  }

  const now = new Date();
  const cycle = client.payment_cycle || "monthly";
  const newEnd = extendSubscriptionEnd(client.subscription_end_date, cycle);
  const paymentAmount =
    amount !== undefined && amount !== null && amount !== ""
      ? Number(amount)
      : client.payment_amount || 0;

  const payment = await PaymentModel.create({
    client_id: client._id,
    package_id: client.package_id,
    amount: paymentAmount,
    date: now,
    status: "approve",
  });

  client.last_payment_date = now;
  client.subscription_end_date = newEnd;
  client.status = "active";
  await client.save();

  if (note && String(note).trim()) {
    client.notes = client.notes || [];
    client.notes.push({
      text: String(note).trim(),
      created_at: now,
    });
    await client.save();
  }

  const clientResponse = client.toObject() as any;
  delete clientResponse.password;
  clientResponse.subscription = buildSubscriptionPayload(client, payment);

  return SuccessResponse(
    res,
    {
      message: "Subscription renewed successfully",
      data: clientResponse,
    },
    200,
  );
});

export const setClientSubscriptionEnd = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const { subscription_end_date } = req.body || {};

  if (!subscription_end_date) {
    throw new BadRequest("subscription_end_date is required");
  }

  const client = await ClientModel.findById(id);
  if (!client) {
    throw new NotFound("Client not found");
  }

  const endDate = endOfDay(subscription_end_date);
  const remaining = remainingFromEndDate(endDate);

  client.subscription_end_date = endDate;
  client.status = remaining.expired ? "inactive" : "active";
  await client.save();

  const lastPayment = await PaymentModel.findOne({
    client_id: client._id,
    status: "approve",
  }).sort({ date: -1 });

  const clientResponse = client.toObject() as any;
  delete clientResponse.password;
  clientResponse.subscription = buildSubscriptionPayload(client, lastPayment);

  return SuccessResponse(
    res,
    {
      message: remaining.expired
        ? "End date saved. Client is inactive because the date is in the past."
        : "Client activated until the selected date",
      data: clientResponse,
    },
    200,
  );
});

export const seedCashierRoleForExistingClients = asyncHandler(
  async (req, res) => {
    const clients = await ClientModel.find();
    let seededCount = 0;
    let existingCount = 0;
    const errors: Array<{ clientId: any; companyName: string; error: string }> = [];

    for (const client of clients) {
      const dbName = (client as any).db_name || `sc_${client._id}`;
      try {
        const clientDb = mongoose.connection.useDb(dbName, { useCache: true });
        const existingRole = await clientDb.collection('roles').findOne({ name: { $regex: /^cashier$/i } });
        if (existingRole) {
          existingCount++;
        } else {
          await seedTenantCashierRole(clientDb);
          seededCount++;
        }
      } catch (err: any) {
        errors.push({ clientId: client._id, companyName: client.company_name || "", error: err.message });
      }
    }

    SuccessResponse(
      res,
      {
        message: 'Seeding Cashier roles completed',
        totalClients: clients.length,
        seededCount,
        existingCount,
        failedCount: errors.length,
        errors,
      },
      200,
    );
  }
);

export const retryProvisionClient = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const client = await ClientModel.findById(id);
  if (!client) {
    throw new NotFound("Client not found");
  }

  if (!client.subdomain) {
    throw new BadRequest("Client does not have a subdomain configured");
  }

  const sanitizedSubdomain = sanitizeSubdomainName(client.subdomain);
  const dbName = client.db_name || `sc_${client._id}`;

  client.provisioning_status = "in_progress";
  client.provisioning_error = undefined;
  await client.save();

  // Always generate a fresh active API key on retry provisioning so the client backend has the matching plaintext key
  const rawApiKey = `sk_${crypto.randomUUID()}_${crypto.randomBytes(16).toString("hex")}`;
  const hashedKey = crypto
    .createHash("sha256")
    .update(rawApiKey)
    .digest("hex");

  await TenantApiKeyModel.updateMany(
    { client_id: client._id, active: true },
    { $set: { active: false } },
  );

  await TenantApiKeyModel.create({
    client_id: client._id,
    hashedKey,
    label: "default",
    active: true,
  });

  const runnerScript = path.resolve(__dirname, "../../scripts/provisionClientRunner.js");
  try {
    const { spawn } = require("child_process");
    const child = spawn(process.execPath, [runnerScript, client._id.toString(), rawApiKey], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    console.log(
      `[Provisioning] Detached runner spawned with PID ${child.pid} for retry on client ${client.company_name} (${client._id})`,
    );
  } catch (spawnError: any) {
    setImmediate(async () => {
      try {
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

        await ClientModel.findByIdAndUpdate(client._id, {
          provisioning_status: "completed",
          subdomain_url: provisionResult.frontendUrl,
        });
      } catch (err: any) {
        await ClientModel.findByIdAndUpdate(client._id, {
          provisioning_status: "failed",
          provisioning_error: err.message || String(err),
        });
      }
    });
  }

  return SuccessResponse(
    res,
    {
      message: "Client provisioning restarted in the background",
      data: client,
    },
    200,
  );
});
