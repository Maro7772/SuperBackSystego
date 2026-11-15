import mongoose from "mongoose";

const PackageSchema = new mongoose.Schema(
  {
    name: { type: String, },
    description: { type: String, },
    monthly_price: { type: Number, required: true },
    quarterly_price: { type: Number, required: true },
    half_yearly_price: { type: Number, required: true },
    yearly_price: { type: Number, required: true },
    status: { type: Boolean },
    haveEcommerce: { type: Boolean, default: false },
    haveMobileApp: { type: Boolean, default: false },
    havePOS: { type: Boolean, default: false },
    haveReports: { type: Boolean, default: false },
    haveStockTake: { type: Boolean, default: false },
    branches: { type: Number, default: 0 },
    online_branches: { type: Number, default: 0 },
    // Optional add-ons chosen for this package.
    extras: [{ type: mongoose.Schema.Types.ObjectId, ref: "Extra" }],
  },
  { timestamps: true, }
);

export const PackageModel = mongoose.model('Package', PackageSchema);
