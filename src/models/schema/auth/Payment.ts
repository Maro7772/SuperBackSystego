import mongoose from "mongoose";

const PaymentSchema = new mongoose.Schema(
  {
    client_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client'
    },
    package_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Package'
    },
    coupon_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon'
    },
    amount: { type: Number, required: true },
    date: { type: Date, },
    status: { type: String, enum: ['pending', 'approve', 'reject'] },
    payment_cycle: { type: String, enum: ['monthly', 'quarterly', 'half_yearly', 'yearly'] },
    screenshot: { type: String },
  },
  { timestamps: true, }
);

export const PaymentModel = mongoose.model('Payment', PaymentSchema);
