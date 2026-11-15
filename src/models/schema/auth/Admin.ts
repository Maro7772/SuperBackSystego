import { Schema, model, Document } from "mongoose";
import bcrypt from "bcrypt";

interface IAdmin extends Document {
  name: string;
  email: string;
  password: string;
  role: "super_admin" | "viewer";
  createdAt: Date;
  updatedAt: Date;
}

const adminSchema = new Schema<IAdmin>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["super_admin", "viewer"],
      default: "super_admin",
    },
  },
  { timestamps: true },
);

// ✅ Hash password قبل الحفظ
adminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return;
  try {
    this.password = await bcrypt.hash(this.password, 10);
  } catch (err: any) {
    next(err);
  }
});

export const AdminModel = model<IAdmin>("Admin", adminSchema);
