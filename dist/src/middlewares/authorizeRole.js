"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeRole = void 0;
const Errors_1 = require("../Errors");
/**
 * Middleware to allow only specific roles.
 * Usage: authorizeRole("super_admin")
 *        authorizeRole("super_admin", "viewer")
 */
const authorizeRole = (...allowedRoles) => {
    return (req, res, next) => {
        const user = req.user;
        if (!user) {
            throw new Errors_1.UnauthorizedError("Not authenticated");
        }
        if (!allowedRoles.includes(user.role)) {
            res.status(403).json({
                success: false,
                message: "You do not have permission to perform this action",
            });
            return;
        }
        next();
    };
};
exports.authorizeRole = authorizeRole;
