"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminSchema = exports.resetPasswordSchema = exports.checkResetCodeSchema = exports.sendResetCodeSchema = exports.verifyEmailSchema = exports.loginSchema = exports.signupSchema = void 0;
const joi_1 = __importDefault(require("joi"));
exports.signupSchema = joi_1.default.object({
    name: joi_1.default.string().min(3).max(50).required(),
    email: joi_1.default.string().email().required(),
    password: joi_1.default.string().min(6).required(),
    imageBase64: joi_1.default.string().optional(),
});
exports.loginSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
    password: joi_1.default.string().min(6).required(),
});
exports.verifyEmailSchema = joi_1.default.object({
    userId: joi_1.default.string().required(),
    code: joi_1.default.string().required(),
});
exports.sendResetCodeSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
});
exports.checkResetCodeSchema = joi_1.default.object({
    email: joi_1.default.string().required(),
    code: joi_1.default.string().required(),
});
exports.resetPasswordSchema = joi_1.default.object({
    email: joi_1.default.string().required(),
    code: joi_1.default.string().required(),
    newPassword: joi_1.default.string().min(6).max(30).required(),
});
exports.createAdminSchema = joi_1.default.object({
    name: joi_1.default.string().min(3).max(50).required().messages({
        "string.min": "Name must be at least 3 characters",
        "string.max": "Name cannot exceed 50 characters",
        "any.required": "Name is required",
    }),
    email: joi_1.default.string().email().required().messages({
        "string.email": "Please provide a valid email",
        "any.required": "Email is required",
    }),
    password: joi_1.default.string().min(6).max(30).required().messages({
        "string.min": "Password must be at least 6 characters",
        "any.required": "Password is required",
    }),
    role: joi_1.default.string().valid("super_admin", "viewer").default("viewer").messages({
        "any.only": "Role must be either super_admin or viewer",
    }),
});
