"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientModel = void 0;
// Mongoose schema for Client
const mongoose_1 = require("mongoose");
const bcrypt_1 = __importDefault(require("bcrypt"));
const ClientSchema = new mongoose_1.Schema({
    company_name: { type: String },
    email: { type: String, unique: true },
    password: { type: String },
    status: { type: String, default: "active" },
    operation_status: {
        type: String,
        enum: ["Demo", "Sales", "Data", "Visit", "Delivered"],
        default: "Demo",
    },
    package_id: { type: mongoose_1.Schema.Types.ObjectId, ref: "Package" },
    db_name: { type: String },
    subdomain: { type: String, unique: true, sparse: true },
    subdomain_url: { type: String },
    logoBase64: { type: String },
    main_location: { type: String, required: false },
    branches_locations: [{ type: String }],
    branches_config: [
        {
            _id: false,
            name: { type: String },
            Is_Online: { type: Boolean, default: false },
        },
    ],
    payment_cycle: {
        type: String,
        enum: ["monthly", "quarterly", "half_yearly", "yearly"],
        default: "monthly",
    },
    payment_amount: { type: Number, required: false },
    contact_person_name: { type: String, required: false }, // Ø§Ø³Ù… Ø§Ù„Ø´Ø®Øµ Ø§Ù„Ù…Ø³Ø¤ÙˆÙ„
    contact_person_phone: { type: String, required: false }, // Ø±Ù‚Ù… ØªÙ„ÙŠÙÙˆÙ†Ù‡
    sales_man_name: { type: String, required: false }, // Ø§Ø³Ù… Ø§Ù„Ø³ÙŠÙ„Ø² Ù…Ø§Ù† Ø§Ù„Ù„ÙŠ Ø¬Ø§Ø¨ Ø§Ù„Ø¹Ù…ÙŠÙ„
    sales_man_phone: { type: String, required: false }, // Ø±Ù‚Ù… Ø§Ù„Ø³ÙŠÙ„Ø² Ù…Ø§Ù† (Ø§Ø®ØªÙŠØ§Ø±ÙŠ)
    notes: [
        {
            text: { type: String, required: true },
            created_at: { type: Date, default: Date.now },
        },
    ],
    provisioning_status: {
        type: String,
        enum: ["pending", "in_progress", "completed", "failed"],
        default: "pending",
    },
    provisioning_error: { type: String },
    last_payment_date: { type: Date, default: Date.now },
    subscription_end_date: { type: Date },
}, { timestamps: true });
ClientSchema.pre("save", async function (next) {
    if (!this.isModified("password") || !this.password)
        return next();
    try {
        const hash = await bcrypt_1.default.hash(this.password, 10);
        this.password = hash;
        next();
    }
    catch (error) {
        return next(error);
    }
});
exports.ClientModel = (0, mongoose_1.model)("Client", ClientSchema);
