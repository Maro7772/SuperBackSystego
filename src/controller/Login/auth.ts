import { Request, Response } from "express";
import { AdminModel } from "../../models/schema/auth/Admin";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { UnauthorizedError, UniqueConstrainError } from "../../Errors";
import { SuccessResponse } from "../../utils/response";

export const login_admin = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new UnauthorizedError("Email and password are required");
  }

  const admin = await AdminModel.findOne({ email });
  if (!admin) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const isPasswordValid = await bcrypt.compare(password, admin.password);
  if (!isPasswordValid) {
    throw new UnauthorizedError("Invalid email or password");
  }

  // ✅ ضفنا role في الـ token
  const token = jwt.sign(
    {
      sub: String(admin._id),
      name: admin.name,
      email: admin.email,
      role: admin.role, // ← جديد
    },
    process.env.JWT_SECRET as string,
    { expiresIn: "1d" },
  );

  return SuccessResponse(
    res,
    {
      message: "Login successful",
      token,
      admin: {
        id: String(admin._id),
        name: admin.name,
        email: admin.email,
        role: admin.role, // ← جديد
      },
    },
    200,
  );
};

/**
 * POST /api/admin/auth/create-admin
 * ينشئ Admin جديد (viewer أو super_admin)
 * ⚠️ super_admin بس
 */
export const create_admin = async (req: Request, res: Response) => {
  const { name, email, password, role } = req.body;

  // تأكد إن الإيميل مش مستخدم
  const exists = await AdminModel.findOne({ email });
  if (exists) {
    throw new UniqueConstrainError("Email already exists");
  }

  const admin = await AdminModel.create({
    name,
    email,
    password, // ← الـ pre-save hook هيعمل hash تلقائي
    role: role === "viewer" ? "viewer" : "super_admin",
  });

  return SuccessResponse(
    res,
    {
      message: "Admin created successfully",
      data: {
        id: String(admin._id),
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    },
    201,
  );
};
