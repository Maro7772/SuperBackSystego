// Mongoose schema for Client
import { Schema, model, Types, Document } from "mongoose";
import bcrypt from "bcrypt";

interface IClient {
  company_name?: string;
  email?: string;
  password?: string;
  status?: string;
  operation_status?: string;
  package_id?: Types.ObjectId;
  db_name?: string;
  subdomain?: string;
  subdomain_url?: string;
  logoBase64?: string;
  main_location?: string;
  branches_locations?: string[];
  branches_config?: Array<{ name: string; Is_Online: boolean }>;
  payment_cycle?: string;
  payment_amount?: number;
  contact_person_name?: string;
  contact_person_phone?: string;
  sales_man_name?: string;
  sales_man_phone?: string;
  notes?: Array<{
    text: string;
    created_at: Date;
  }>;
  last_payment_date?: Date;
  subscription_end_date?: Date;
  created_at?: Date;
  updated_at?: Date;
}

const ClientSchema = new Schema<IClient>(
  {
    company_name: { type: String },
    email: { type: String, unique: true },
    password: { type: String },
    status: { type: String, default: "active" },
    operation_status: {
      type: String,
      enum: ["Demo", "Sales", "Data", "Visit", "Delivered"],
      default: "Demo",
    },
    package_id: { type: Schema.Types.ObjectId, ref: "Package" },
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
    last_payment_date: { type: Date, default: Date.now },
    subscription_end_date: { type: Date },
  },
  { timestamps: true },
);

ClientSchema.pre(
  "save",
  async function (this: IClient & Document, next: (err?: any) => void) {
    if (!this.isModified("password") || !this.password) return next();
    try {
      const hash = await bcrypt.hash(this.password, 10);
      this.password = hash;
      next();
    } catch (error) {
      return next(error);
    }
  },
);
export const ClientModel = model<IClient>("Client", ClientSchema);
