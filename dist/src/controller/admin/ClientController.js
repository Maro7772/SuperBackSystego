"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryProvisionClient = exports.seedCashierRoleForExistingClients = exports.setClientSubscriptionEnd = exports.renewClientSubscription = exports.generateApiKeysForExistingClients = exports.regenerateApiKey = exports.viewSelection = exports.installClientSsl = exports.select = exports.regenerateClientEnv = exports.deployClientBackend = exports.rebuildClientFrontend = exports.getClientsByStatus = exports.deleteClient = exports.updateClient = exports.createClient = exports.getClientById = exports.getAllClients = void 0;
const Client_1 = require("../../models/schema/auth/Client");
const mongoose_1 = __importDefault(require("mongoose"));
const express_async_handler_1 = __importDefault(require("express-async-handler"));
const path_1 = __importDefault(require("path"));
const NotFound_1 = require("../../Errors/NotFound");
const response_1 = require("../../utils/response");
const Package_1 = require("../../models/schema/auth/Package");
const Errors_1 = require("../../Errors");
const crypto_1 = __importDefault(require("crypto"));
const seedTenantRoles_1 = require("../../utils/seedTenantRoles");
const PleskService_1 = require("../../utils/PleskService");
const ClientProvisioner_1 = require("../../utils/ClientProvisioner");
const PleskService_2 = require("../../utils/PleskService");
const TenantApiKey_1 = require("../../models/schema/auth/TenantApiKey");
const subscription_util_1 = require("../../utils/subscription.util");
const Payment_1 = require("../../models/schema/auth/Payment");
const BadRequest_1 = require("../../Errors/BadRequest");
const clientBranches_1 = require("../../utils/clientBranches");
exports.getAllClients = (0, express_async_handler_1.default)(async (req, res) => {
    const clients = await Client_1.ClientModel.find()
        .select("-password -logoBase64 -admin_password")
        .sort({ created_at: -1 })
        .populate({
        path: "package_id",
        select: "name price features",
    });
    const clientsWithSubscription = await Promise.all(clients.map(async (client) => {
        const lastPayment = await Payment_1.PaymentModel.findOne({
            client_id: client._id,
            status: "approve",
        }).sort({ date: -1 });
        return {
            ...client.toObject(),
            subscription: (0, subscription_util_1.buildSubscriptionPayload)(client, lastPayment),
        };
    }));
    return (0, response_1.SuccessResponse)(res, {
        message: "Clients retrieved successfully",
        data: clientsWithSubscription,
    }, 200);
});
exports.getClientById = (0, express_async_handler_1.default)(async (req, res) => {
    const id = req.params.id;
    const client = await Client_1.ClientModel.findOne({ _id: id })
        .select("-password")
        .populate("package_id");
    if (!client) {
        throw new NotFound_1.NotFound("Client not found");
    }
    const lastPayment = await Payment_1.PaymentModel.findOne({
        client_id: client._id,
        status: "approve",
    }).sort({ date: -1 });
    const clientResponse = client.toObject();
    clientResponse.subscription = (0, subscription_util_1.buildSubscriptionPayload)(client, lastPayment);
    // Read the branches that actually exist in the client's own admin, so the
    // owner can see what is already there (including legacy branches).
    clientResponse.existing_branches = await (0, clientBranches_1.readClientBranches)(client.db_name, client._id, (0, clientBranches_1.legacyBranchNames)(client));
    return (0, response_1.SuccessResponse)(res, { message: "Client retrieved successfully", data: clientResponse }, 200);
});
exports.createClient = (0, express_async_handler_1.default)(async (req, res) => {
    const { company_name, email, password, status, package_id, subdomain, logoBase64, main_location, branches_locations, branches_config, payment_cycle, payment_amount, contact_person_name, contact_person_phone, sales_man_name, sales_man_phone, subscription_end_date, } = req.body;
    const existingPackage = await Package_1.PackageModel.findById(package_id);
    if (!existingPackage) {
        throw new NotFound_1.NotFound("Package not found");
    }
    const existingClient = await Client_1.ClientModel.findOne({ email });
    if (existingClient) {
        throw new Errors_1.UniqueConstrainError("Client with this email already exists");
    }
    const validationError = (0, PleskService_1.validateSubdomainName)(subdomain);
    if (validationError) {
        throw new Errors_1.UniqueConstrainError(validationError);
    }
    const sanitizedSubdomain = (0, PleskService_1.sanitizeSubdomainName)(subdomain);
    const existingSubdomain = await Client_1.ClientModel.findOne({
        subdomain: sanitizedSubdomain,
    });
    if (existingSubdomain) {
        throw new Errors_1.UniqueConstrainError(`Subdomain "${sanitizedSubdomain}.systego.net" is already taken`);
    }
    const now = new Date();
    const cycle = payment_cycle || "monthly";
    const computedEnd = subscription_end_date
        ? (0, subscription_util_1.endOfDay)(subscription_end_date)
        : (0, subscription_util_1.addCycleDays)(now, cycle);
    const client = await Client_1.ClientModel.create({
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
        const newDbConnection = mongoose_1.default.connection.useDb(dbName, {
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
        }
        catch (e) {
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
        console.log(`Database ${dbName} created and seeded with compliant superadmin`);
        // Seed default Cashier role for the tenant
        await (0, seedTenantRoles_1.seedTenantCashierRole)(newDbConnection);
    }
    catch (error) {
        console.error("Failed to create client database:", error);
        try {
            const dropDb = mongoose_1.default.connection.useDb(dbName, { useCache: false });
            await dropDb.dropDatabase();
        }
        catch (dropErr) {
            console.warn(`Could not drop database ${dbName} during rollback:`, dropErr);
        }
        await Client_1.ClientModel.findByIdAndDelete(client._id);
        throw new Error(`Failed to create client database: ${error.message || error}. Client creation rolled back.`);
    }
    // Generate tenant API key BEFORE provisioning so it can be written into the
    // client backend .env (avoids NOT_SET / cross-client key leakage).
    let rawApiKey;
    try {
        rawApiKey = `sk_${crypto_1.default.randomUUID()}_${crypto_1.default.randomBytes(16).toString("hex")}`;
        const hashedKey = crypto_1.default
            .createHash("sha256")
            .update(rawApiKey)
            .digest("hex");
        await TenantApiKey_1.TenantApiKeyModel.create({
            client_id: client._id,
            hashedKey,
            label: "default",
            active: true,
        });
        console.log(`[Provisioning] Tenant API key generated for client: ${client.company_name}`);
    }
    catch (apiKeyError) {
        console.error("Failed to generate tenant API key:", apiKeyError.message);
    }
    const parentDomain = process.env.PLESK_PARENT_DOMAIN || "systego.net";
    const expectedFrontendUrl = `https://${sanitizedSubdomain}.${parentDomain}`;
    client.db_name = dbName;
    client.subdomain_url = expectedFrontendUrl;
    client.provisioning_status = "in_progress";
    await client.save();
    // Spawn detached provisioning process that survives Passenger web worker reloads!
    const runnerScript = path_1.default.resolve(__dirname, "../../scripts/provisionClientRunner.js");
    try {
        const { spawn } = require("child_process");
        const child = spawn(process.execPath, [runnerScript, client._id.toString()], {
            detached: true,
            stdio: "ignore",
        });
        child.unref();
        console.log(`[Provisioning] Detached background runner spawned with PID ${child.pid} for client ${client.company_name} (${client._id})`);
    }
    catch (spawnError) {
        console.error(`[Provisioning] Failed to spawn detached runner, falling back to setImmediate:`, spawnError.message);
        setImmediate(async () => {
            try {
                const provisionResult = await (0, ClientProvisioner_1.provisionNewClient)(sanitizedSubdomain, {
                    dbName: dbName,
                    dbUser: process.env.MONGO_USER || "admin",
                    dbPass: encodeURIComponent(process.env.MONGO_PASS || "MONGO@3030"),
                }, logoBase64, rawApiKey);
                await Client_1.ClientModel.findByIdAndUpdate(client._id, {
                    provisioning_status: "completed",
                    subdomain_url: provisionResult.frontendUrl,
                });
            }
            catch (err) {
                await Client_1.ClientModel.findByIdAndUpdate(client._id, {
                    provisioning_status: "failed",
                    provisioning_error: err.message || String(err),
                });
            }
        });
    }
    const clientResponse = client.toObject();
    delete clientResponse.admin_password;
    delete clientResponse.password;
    clientResponse.db_name = dbName;
    clientResponse.subdomain_url = expectedFrontendUrl;
    return (0, response_1.SuccessResponse)(res, {
        message: "Client created successfully. Subdomain and backend deployment are running in the background.",
        data: clientResponse,
    }, 201);
});
// ============================================================
// âœ… UPDATE CLIENT â€” Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ù…Ø¹Ø¯Ù„Ø©
// ============================================================
exports.updateClient = (0, express_async_handler_1.default)(async (req, res) => {
    const id = req.params.id;
    const updateData = { ...req.body };
    // Prevent subdomain changes
    if (updateData.subdomain || updateData.subdomain_url) {
        delete updateData.subdomain;
        delete updateData.subdomain_url;
    }
    if (updateData.subscription_end_date === "" ||
        updateData.subscription_end_date === null) {
        delete updateData.subscription_end_date;
    }
    else if (updateData.subscription_end_date) {
        updateData.subscription_end_date = (0, subscription_util_1.endOfDay)(updateData.subscription_end_date);
    }
    const existingClient = await Client_1.ClientModel.findById(id);
    if (!existingClient) {
        throw new NotFound_1.NotFound("Client not found");
    }
    if (updateData.status === "active" && !updateData.subscription_end_date) {
        const lastPayment = await Payment_1.PaymentModel.findOne({
            client_id: existingClient._id,
            status: "approve",
        }).sort({ date: -1 });
        const { expired } = (0, subscription_util_1.resolveSubscription)(existingClient, lastPayment?.date);
        if (expired) {
            throw new BadRequest_1.BadRequest("Subscription has expired. Record a payment or set an end date before activating.");
        }
    }
    // Only derive the status from the (new) subscription end date when the
    // caller did not explicitly send one. An explicit status — e.g. the owner
    // setting a client to "inactive" — must always win, otherwise it was being
    // silently forced back to "active".
    if (updateData.subscription_end_date && updateData.status === undefined) {
        const { expired } = (0, subscription_util_1.remainingFromEndDate)(updateData.subscription_end_date);
        updateData.status = expired ? "inactive" : "active";
    }
    // âœ… Ø´ÙˆÙ Ù„Ùˆ Ø§Ù„Ø¨Ø§Ø³ÙˆØ±Ø¯ Ø¬Ø§ÙŠ Ø¬Ø¯ÙŠØ¯
    const newPassword = updateData.password && updateData.password.trim() !== ""
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
    const client = await Client_1.ClientModel.findOneAndUpdate({ _id: id }, updateData, {
        new: true,
        runValidators: true,
    })
        .select("-password")
        .populate("package_id");
    if (!client) {
        throw new NotFound_1.NotFound("Client not found");
    }
    // âœ…âœ…âœ… Ù„Ùˆ Ø§Ù„Ø¨Ø§Ø³ÙˆØ±Ø¯ Ø§ØªØºÙŠØ±ØŒ Ù†Ø­Ø¯Ø«Ù‡ ÙƒÙ…Ø§Ù† ÙÙŠ Ø§Ù„Ù€ DB Ø¨ØªØ§Ø¹Ø© Ø§Ù„Ø¹Ù…ÙŠÙ„
    if (newPassword && client.db_name) {
        try {
            const bcrypt = require("bcryptjs");
            const salt = await bcrypt.genSalt(10);
            const newPasswordHash = await bcrypt.hash(newPassword, salt);
            const clientDb = mongoose_1.default.connection.useDb(client.db_name, {
                useCache: true,
            });
            const result = await clientDb.collection("users").updateOne({ username: "admin" }, {
                $set: {
                    password_hash: newPasswordHash,
                    updatedAt: new Date(),
                },
            });
            console.log(`[updateClient] Password synced to client DB "${client.db_name}" â€” matched: ${result.matchedCount}, modified: ${result.modifiedCount}`);
        }
        catch (err) {
            console.error(`[updateClient] Failed to sync password to client DB: ${err.message}`);
            // âš ï¸ Ù…Ù…ÙƒÙ† ØªØ®ØªØ§Ø± ØªØ±Ù…ÙŠ Error Ø£Ùˆ ØªÙƒÙ…Ù„. Ø£Ù†Ø§ Ù‡ÙƒÙ…Ù„ Ø¹Ø´Ø§Ù† Ù…ØªØ¹Ø±Ù‚Ù„Ø´ Ø§Ù„ØªØ¹Ø¯ÙŠÙ„
        }
    }
    if (logoBase64 && client.subdomain) {
        const { updateClientLogo } = require("../../utils/ClientProvisioner");
        await updateClientLogo(client.subdomain, logoBase64);
    }
    return (0, response_1.SuccessResponse)(res, { message: "Client updated successfully", data: client }, 200);
});
exports.deleteClient = (0, express_async_handler_1.default)(async (req, res) => {
    const id = req.params.id;
    const client = await Client_1.ClientModel.findById(id);
    if (!client) {
        throw new NotFound_1.NotFound("Client not found");
    }
    if (client.subdomain) {
        try {
            await (0, PleskService_1.deleteSubdomain)(client.subdomain);
            console.log(`Frontend subdomain ${client.subdomain_url} deleted from Plesk`);
            const backendSubdomain = `api-${client.subdomain}`;
            await (0, PleskService_1.deleteSubdomain)(backendSubdomain);
            console.log(`Backend subdomain ${backendSubdomain}.systego.net deleted from Plesk`);
        }
        catch (error) {
            console.error("Failed to delete subdomains from Plesk:", error.message);
        }
    }
    if (client.db_name) {
        try {
            await mongoose_1.default.connection
                .useDb(client.db_name, { useCache: true })
                .dropDatabase();
            console.log(`Database ${client.db_name} dropped`);
        }
        catch (error) {
            console.error("Failed to drop client database:", error);
        }
    }
    await Client_1.ClientModel.findByIdAndDelete(id);
    return (0, response_1.SuccessResponse)(res, { message: "Client deleted successfully" }, 200);
});
exports.getClientsByStatus = (0, express_async_handler_1.default)(async (req, res) => {
    const { status } = req.params;
    const clients = await Client_1.ClientModel.find({ status })
        .sort({ created_at: -1 })
        .populate("package_id");
    return (0, response_1.SuccessResponse)(res, {
        message: `Clients with status ${status} retrieved successfully`,
        data: clients,
    }, 200);
});
exports.rebuildClientFrontend = (0, express_async_handler_1.default)(async (req, res) => {
    const id = req.params.id;
    const client = await Client_1.ClientModel.findById(id);
    if (!client) {
        throw new NotFound_1.NotFound("Client not found");
    }
    if (!client.subdomain) {
        res
            .status(400)
            .json({ success: false, message: "Client has no subdomain" });
        return;
    }
    try {
        await (0, ClientProvisioner_1.rebuildFrontendForClient)(client.subdomain);
        return (0, response_1.SuccessResponse)(res, { message: "Frontend rebuilt successfully" }, 200);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to rebuild frontend",
            error: error.message,
        });
    }
});
exports.deployClientBackend = (0, express_async_handler_1.default)(async (req, res) => {
    const id = req.params.id;
    const client = await Client_1.ClientModel.findById(id);
    if (!client) {
        throw new NotFound_1.NotFound("Client not found");
    }
    if (!client.subdomain) {
        res
            .status(400)
            .json({ success: false, message: "Client has no subdomain" });
        return;
    }
    try {
        const path = require("path");
        const PLESK_VHOSTS_DIR = process.env.PLESK_VHOSTS_DIR || "/var/www/vhosts/systego.net/subdomains";
        const backendDestDir = path.join(PLESK_VHOSTS_DIR, `api-${client.subdomain}`);
        const backendSubdomainUrl = `api-${client.subdomain}.systego.net`;
        await (0, ClientProvisioner_1.deployBackendForClient)(client.subdomain, backendSubdomainUrl, backendDestDir);
        return (0, response_1.SuccessResponse)(res, {
            message: "Backend Node.js application deployed and restarted successfully",
        }, 200);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to deploy backend on Plesk",
            error: error.message,
        });
    }
});
exports.regenerateClientEnv = (0, express_async_handler_1.default)(async (req, res) => {
    const id = req.params.id;
    const client = await Client_1.ClientModel.findById(id);
    if (!client) {
        throw new NotFound_1.NotFound("Client not found");
    }
    if (!client.subdomain) {
        res
            .status(400)
            .json({ success: false, message: "Client has no subdomain" });
        return;
    }
    try {
        const path = require("path");
        const PLESK_VHOSTS_DIR = process.env.PLESK_VHOSTS_DIR || "/var/www/vhosts/systego.net/subdomains";
        const backendDestDir = path.join(PLESK_VHOSTS_DIR, `api-${client.subdomain}`);
        const frontendUrl = `${client.subdomain}.systego.net`;
        const dbName = `sc_${client._id}`;
        await (0, ClientProvisioner_1.generateBackendEnv)(backendDestDir, client.subdomain, frontendUrl, {
            dbName,
            dbUser: process.env.MONGO_USER || "admin",
            dbPass: encodeURIComponent(process.env.MONGO_PASS || "MONGO@3030"),
        });
        const apiSubdomain = `api-${client.subdomain}.systego.net`;
        await (0, PleskService_2.executePleskCli)("extension", [
            "--call",
            "nodejs",
            "--disable",
            "-domain",
            apiSubdomain,
        ]);
        await (0, PleskService_2.executePleskCli)("extension", [
            "--call",
            "nodejs",
            "--enable",
            "-domain",
            apiSubdomain,
        ]);
        return (0, response_1.SuccessResponse)(res, { message: "Backend .env regenerated and app restarted successfully" }, 200);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to regenerate .env",
            error: error.message,
        });
    }
});
exports.select = (0, express_async_handler_1.default)(async (req, res) => {
    const packages = await Package_1.PackageModel.find()
        .select("name")
        .sort({ created_at: -1 });
    return (0, response_1.SuccessResponse)(res, { message: "Packages retrieved successfully", data: packages }, 200);
});
exports.installClientSsl = (0, express_async_handler_1.default)(async (req, res) => {
    const id = req.params.id;
    const client = await Client_1.ClientModel.findById(id);
    if (!client || !client.subdomain) {
        throw new NotFound_1.NotFound("Client or subdomain not found");
    }
    const frontendSubdomainUrl = `${client.subdomain}.systego.net`;
    const backendSubdomainUrl = `api-${client.subdomain}.systego.net`;
    console.log(`[SSL API] Starting SSL installation for client: ${client.company_name}`);
    try {
        const { executePleskCli } = require("../../utils/PleskService");
        const adminEmail = process.env.SSL_ADMIN_EMAIL || "systego.eg@gmail.com";
        console.log(`[SSL API] Waiting 10 seconds for Web Server configuration to reload...`);
        const { setTimeout } = require("timers/promises");
        await setTimeout(10000);
        console.log(`[SSL API] Installing Let's Encrypt SSL for ${frontendSubdomainUrl}...`);
        await executePleskCli("extension", [
            "--exec",
            "letsencrypt",
            "cli.php",
            "-d",
            frontendSubdomainUrl,
            "-m",
            adminEmail,
        ]);
        console.log(`[SSL API] Installing Let's Encrypt SSL for ${backendSubdomainUrl}...`);
        await executePleskCli("extension", [
            "--exec",
            "letsencrypt",
            "cli.php",
            "-d",
            backendSubdomainUrl,
            "-m",
            adminEmail,
        ]);
        (0, response_1.SuccessResponse)(res, { message: "SSL certificates successfully installed" }, 200);
    }
    catch (error) {
        console.error("[SSL API] Failed to install SSL:", error);
        res.status(500).json({
            success: false,
            message: `Failed to install SSL certificates: ${error.message}`,
        });
    }
});
exports.viewSelection = (0, express_async_handler_1.default)(async (req, res) => {
    const packages = await Package_1.PackageModel.find();
    return (0, response_1.SuccessResponse)(res, { message: "Packages retrieved successfully", data: packages }, 200);
});
exports.regenerateApiKey = (0, express_async_handler_1.default)(async (req, res) => {
    const id = req.params.id;
    const client = await Client_1.ClientModel.findById(id);
    if (!client) {
        throw new NotFound_1.NotFound("Client not found");
    }
    await TenantApiKey_1.TenantApiKeyModel.updateMany({ client_id: client._id, active: true }, { $set: { active: false } });
    const rawApiKey = `sk_${crypto_1.default.randomUUID()}_${crypto_1.default.randomBytes(16).toString("hex")}`;
    const hashedKey = crypto_1.default.createHash("sha256").update(rawApiKey).digest("hex");
    await TenantApiKey_1.TenantApiKeyModel.create({
        client_id: client._id,
        hashedKey,
        label: "regenerated",
        active: true,
    });
    // Send the response immediately so the frontend gets the key without waiting
    // for the (potentially slow) Plesk .env update / app restart.
    (0, response_1.SuccessResponse)(res, {
        message: "API key regenerated successfully. Store this key securely - it will not be shown again.",
        data: { apiKey: rawApiKey },
    }, 200);
    // Best-effort: update the client backend .env and restart the app in the
    // background. Failures are logged but never block the response.
    if (client.subdomain && rawApiKey) {
        (async () => {
            try {
                const path = require("path");
                const PLESK_VHOSTS_DIR = process.env.PLESK_VHOSTS_DIR ||
                    "/var/www/vhosts/systego.net/subdomains";
                const backendDestDir = path.join(PLESK_VHOSTS_DIR, `api-${client.subdomain}`);
                const frontendUrl = `${client.subdomain}.systego.net`;
                const dbName = client.db_name || `sc_${client._id}`;
                await (0, ClientProvisioner_1.generateBackendEnv)(backendDestDir, client.subdomain, frontendUrl, {
                    dbName,
                    dbUser: process.env.MONGO_USER || "admin",
                    dbPass: encodeURIComponent(process.env.MONGO_PASS || "MONGO@3030"),
                }, rawApiKey);
                const apiSubdomain = `api-${client.subdomain}.systego.net`;
                await (0, PleskService_2.executePleskCli)("extension", [
                    "--call",
                    "nodejs",
                    "--disable",
                    "-domain",
                    apiSubdomain,
                ]);
                await (0, PleskService_2.executePleskCli)("extension", [
                    "--call",
                    "nodejs",
                    "--enable",
                    "-domain",
                    apiSubdomain,
                ]);
                console.log(`[API Key] Updated .env and restarted backend for ${client.company_name}`);
            }
            catch (envError) {
                console.error(`[API Key] Failed to update .env on server: ${envError.message}`);
            }
        })();
    }
});
exports.generateApiKeysForExistingClients = (0, express_async_handler_1.default)(async (req, res) => {
    const { updateEnv } = req.body;
    const allClients = await Client_1.ClientModel.find().select("_id company_name subdomain db_name");
    const existingKeys = await TenantApiKey_1.TenantApiKeyModel.find({ active: true }).select("client_id");
    const clientsWithKeys = new Set(existingKeys.map((k) => k.client_id.toString()));
    const clientsNeedingKeys = allClients.filter((c) => !clientsWithKeys.has(c._id.toString()));
    if (clientsNeedingKeys.length === 0) {
        return (0, response_1.SuccessResponse)(res, {
            message: "All clients already have active API keys. No action needed.",
            data: { generated: 0 },
        }, 200);
    }
    const results = [];
    for (const client of clientsNeedingKeys) {
        const rawApiKey = `sk_${crypto_1.default.randomUUID()}_${crypto_1.default.randomBytes(16).toString("hex")}`;
        const hashedKey = crypto_1.default
            .createHash("sha256")
            .update(rawApiKey)
            .digest("hex");
        await TenantApiKey_1.TenantApiKeyModel.create({
            client_id: client._id,
            hashedKey,
            label: "migration",
            active: true,
        });
        let envUpdated = false;
        if (updateEnv && client.subdomain) {
            try {
                const path = require("path");
                const PLESK_VHOSTS_DIR = process.env.PLESK_VHOSTS_DIR ||
                    "/var/www/vhosts/systego.net/subdomains";
                const backendDestDir = path.join(PLESK_VHOSTS_DIR, `api-${client.subdomain}`);
                const frontendUrl = `${client.subdomain}.systego.net`;
                const dbName = client.db_name || `sc_${client._id}`;
                await (0, ClientProvisioner_1.generateBackendEnv)(backendDestDir, client.subdomain, frontendUrl, {
                    dbName,
                    dbUser: process.env.MONGO_USER || "admin",
                    dbPass: encodeURIComponent(process.env.MONGO_PASS || "MONGO@3030"),
                }, rawApiKey);
                const apiSubdomain = `api-${client.subdomain}.systego.net`;
                await (0, PleskService_2.executePleskCli)("extension", [
                    "--call",
                    "nodejs",
                    "--disable",
                    "-domain",
                    apiSubdomain,
                ]);
                await (0, PleskService_2.executePleskCli)("extension", [
                    "--call",
                    "nodejs",
                    "--enable",
                    "-domain",
                    apiSubdomain,
                ]);
                envUpdated = true;
            }
            catch (err) {
                console.error(`[Migration] Failed to update .env for ${client.company_name}: ${err.message}`);
            }
        }
        results.push({
            clientId: client._id.toString(),
            companyName: client.company_name,
            subdomain: client.subdomain,
            apiKey: rawApiKey,
            envUpdated,
        });
        console.log(`[Migration] Generated API key for ${client.company_name} (${client.subdomain})`);
    }
    return (0, response_1.SuccessResponse)(res, {
        message: `Generated API keys for ${results.length} existing clients. Store these keys securely â€” they will not be shown again!`,
        data: { generated: results.length, clients: results },
    }, 200);
});
exports.renewClientSubscription = (0, express_async_handler_1.default)(async (req, res) => {
    const id = req.params.id;
    const { amount, note } = req.body || {};
    const client = await Client_1.ClientModel.findById(id);
    if (!client) {
        throw new NotFound_1.NotFound("Client not found");
    }
    const now = new Date();
    const cycle = client.payment_cycle || "monthly";
    const newEnd = (0, subscription_util_1.extendSubscriptionEnd)(client.subscription_end_date, cycle);
    const paymentAmount = amount !== undefined && amount !== null && amount !== ""
        ? Number(amount)
        : client.payment_amount || 0;
    const payment = await Payment_1.PaymentModel.create({
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
    const clientResponse = client.toObject();
    delete clientResponse.password;
    clientResponse.subscription = (0, subscription_util_1.buildSubscriptionPayload)(client, payment);
    return (0, response_1.SuccessResponse)(res, {
        message: "Subscription renewed successfully",
        data: clientResponse,
    }, 200);
});
exports.setClientSubscriptionEnd = (0, express_async_handler_1.default)(async (req, res) => {
    const id = req.params.id;
    const { subscription_end_date } = req.body || {};
    if (!subscription_end_date) {
        throw new BadRequest_1.BadRequest("subscription_end_date is required");
    }
    const client = await Client_1.ClientModel.findById(id);
    if (!client) {
        throw new NotFound_1.NotFound("Client not found");
    }
    const endDate = (0, subscription_util_1.endOfDay)(subscription_end_date);
    const remaining = (0, subscription_util_1.remainingFromEndDate)(endDate);
    client.subscription_end_date = endDate;
    client.status = remaining.expired ? "inactive" : "active";
    await client.save();
    const lastPayment = await Payment_1.PaymentModel.findOne({
        client_id: client._id,
        status: "approve",
    }).sort({ date: -1 });
    const clientResponse = client.toObject();
    delete clientResponse.password;
    clientResponse.subscription = (0, subscription_util_1.buildSubscriptionPayload)(client, lastPayment);
    return (0, response_1.SuccessResponse)(res, {
        message: remaining.expired
            ? "End date saved. Client is inactive because the date is in the past."
            : "Client activated until the selected date",
        data: clientResponse,
    }, 200);
});
exports.seedCashierRoleForExistingClients = (0, express_async_handler_1.default)(async (req, res) => {
    const clients = await Client_1.ClientModel.find();
    let seededCount = 0;
    let existingCount = 0;
    const errors = [];
    for (const client of clients) {
        const dbName = client.db_name || `sc_${client._id}`;
        try {
            const clientDb = mongoose_1.default.connection.useDb(dbName, { useCache: true });
            const existingRole = await clientDb.collection('roles').findOne({ name: { $regex: /^cashier$/i } });
            if (existingRole) {
                existingCount++;
            }
            else {
                await (0, seedTenantRoles_1.seedTenantCashierRole)(clientDb);
                seededCount++;
            }
        }
        catch (err) {
            errors.push({ clientId: client._id, companyName: client.company_name || "", error: err.message });
        }
    }
    (0, response_1.SuccessResponse)(res, {
        message: 'Seeding Cashier roles completed',
        totalClients: clients.length,
        seededCount,
        existingCount,
        failedCount: errors.length,
        errors,
    }, 200);
});
exports.retryProvisionClient = (0, express_async_handler_1.default)(async (req, res) => {
    const { id } = req.params;
    const client = await Client_1.ClientModel.findById(id);
    if (!client) {
        throw new NotFound_1.NotFound("Client not found");
    }
    if (!client.subdomain) {
        throw new BadRequest_1.BadRequest("Client does not have a subdomain configured");
    }
    const sanitizedSubdomain = (0, PleskService_1.sanitizeSubdomainName)(client.subdomain);
    const dbName = client.db_name || `sc_${client._id}`;
    client.provisioning_status = "in_progress";
    client.provisioning_error = undefined;
    await client.save();
    // Find or generate API key
    let rawApiKey;
    const existingApiKeyDoc = await TenantApiKey_1.TenantApiKeyModel.findOne({
        client_id: client._id,
        active: true,
    });
    if (!existingApiKeyDoc) {
        rawApiKey = `sk_${crypto_1.default.randomUUID()}_${crypto_1.default.randomBytes(16).toString("hex")}`;
        const hashedKey = crypto_1.default
            .createHash("sha256")
            .update(rawApiKey)
            .digest("hex");
        await TenantApiKey_1.TenantApiKeyModel.create({
            client_id: client._id,
            hashedKey,
            label: "default",
            active: true,
        });
    }
    const runnerScript = path_1.default.resolve(__dirname, "../../scripts/provisionClientRunner.js");
    try {
        const { spawn } = require("child_process");
        const child = spawn(process.execPath, [runnerScript, client._id.toString()], {
            detached: true,
            stdio: "ignore",
        });
        child.unref();
        console.log(`[Provisioning] Detached runner spawned with PID ${child.pid} for retry on client ${client.company_name} (${client._id})`);
    }
    catch (spawnError) {
        setImmediate(async () => {
            try {
                const provisionResult = await (0, ClientProvisioner_1.provisionNewClient)(sanitizedSubdomain, {
                    dbName,
                    dbUser: process.env.MONGO_USER || "admin",
                    dbPass: encodeURIComponent(process.env.MONGO_PASS || "MONGO@3030"),
                }, client.logoBase64, rawApiKey);
                await Client_1.ClientModel.findByIdAndUpdate(client._id, {
                    provisioning_status: "completed",
                    subdomain_url: provisionResult.frontendUrl,
                });
            }
            catch (err) {
                await Client_1.ClientModel.findByIdAndUpdate(client._id, {
                    provisioning_status: "failed",
                    provisioning_error: err.message || String(err),
                });
            }
        });
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Client provisioning restarted in the background",
        data: client,
    }, 200);
});
