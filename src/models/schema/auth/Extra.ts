import mongoose from "mongoose";

const ExtraSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    ar_name: { type: String },
    description: { type: String },
    ar_description: { type: String },
    // false = one-time add-on, true = recurring (charged every cycle)
    is_recurring: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const ExtraModel = mongoose.model("Extra", ExtraSchema);
