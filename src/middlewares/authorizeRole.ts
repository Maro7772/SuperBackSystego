import { Request, Response, NextFunction } from "express";
import { UnauthorizedError } from "../Errors";

/**
 * Middleware to allow only specific roles.
 * Usage: authorizeRole("super_admin")
 *        authorizeRole("super_admin", "viewer")
 */
export const authorizeRole = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user) {
      throw new UnauthorizedError("Not authenticated");
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
