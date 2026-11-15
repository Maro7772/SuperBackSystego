"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_admin = exports.login_admin = void 0;
const Admin_1 = require("../../models/schema/auth/Admin");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const Errors_1 = require("../../Errors");
const response_1 = require("../../utils/response");
const login_admin = async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        throw new Errors_1.UnauthorizedError("Email and password are required");
    }
    const admin = await Admin_1.AdminModel.findOne({ email });
    if (!admin) {
        throw new Errors_1.UnauthorizedError("Invalid email or password");
    }
    const isPasswordValid = await bcrypt_1.default.compare(password, admin.password);
    if (!isPasswordValid) {
        throw new Errors_1.UnauthorizedError("Invalid email or password");
    }
    // ✅ ضفنا role في الـ token
    const token = jsonwebtoken_1.default.sign({
        sub: String(admin._id),
        name: admin.name,
        email: admin.email,
        role: admin.role, // ← جديد
    }, process.env.JWT_SECRET, { expiresIn: "1d" });
    return (0, response_1.SuccessResponse)(res, {
        message: "Login successful",
        token,
        admin: {
            id: String(admin._id),
            name: admin.name,
            email: admin.email,
            role: admin.role, // ← جديد
        },
    }, 200);
};
exports.login_admin = login_admin;
/**
 * POST /api/admin/auth/create-admin
 * ينشئ Admin جديد (viewer أو super_admin)
 * ⚠️ super_admin بس
 */
const create_admin = async (req, res) => {
    const { name, email, password, role } = req.body;
    // تأكد إن الإيميل مش مستخدم
    const exists = await Admin_1.AdminModel.findOne({ email });
    if (exists) {
        throw new Errors_1.UniqueConstrainError("Email already exists");
    }
    const admin = await Admin_1.AdminModel.create({
        name,
        email,
        password, // ← الـ pre-save hook هيعمل hash تلقائي
        role: role === "viewer" ? "viewer" : "super_admin",
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Admin created successfully",
        data: {
            id: String(admin._id),
            name: admin.name,
            email: admin.email,
            role: admin.role,
        },
    }, 201);
};
exports.create_admin = create_admin;
