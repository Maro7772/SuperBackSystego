"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminModel = void 0;
const mongoose_1 = require("mongoose");
const bcrypt_1 = __importDefault(require("bcrypt"));
const adminSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
        type: String,
        enum: ["super_admin", "viewer"],
        default: "super_admin",
    },
}, { timestamps: true });
// ✅ Hash password قبل الحفظ
adminSchema.pre("save", async function (next) {
    if (!this.isModified("password"))
        return;
    try {
        this.password = await bcrypt_1.default.hash(this.password, 10);
    }
    catch (err) {
        next(err);
    }
});
exports.AdminModel = (0, mongoose_1.model)("Admin", adminSchema);
