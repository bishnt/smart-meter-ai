import mongoose, { Schema, Document } from "mongoose";
import { RatePlan } from "../types/users.ts";

interface IMeter extends Document {
  meter_id: string;
  node_type: string;
  installation_date: Date;
  location: string;
  ratePlan: RatePlan;
  static_details: Record<string, any>;
}

const DemandChargeSchema = new Schema(
  {
    type: { type: String, enum: ["peak", "offpeak"], required: true },
    costPerKw: { type: Number, required: true },
  },
  { _id: false }
);

const TOUTierSchema = new Schema(
  {
    startHour: { type: Number, required: true },
    endHour: { type: Number, required: true },
    costPerKwh: { type: Number, required: true },
  },
  { _id: false }
);

const RatePlanSchema = new Schema(
  {
    costKwh: { type: Number, required: true },
    fixedFee: { type: Number },
    demandCharges: { type: [DemandChargeSchema] },
    touTiers: { type: [TOUTierSchema] },
  },
  { _id: false }
);

const MeterSchema = new Schema<IMeter>(
  {
    meter_id: { type: String, required: true },
    node_type: { type: String, required: true },
    installation_date: { type: Date, required: true },
    location: { type: String, required: true },
    ratePlan: { type: RatePlanSchema, required: true },
    static_details: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

export const MeterModel = mongoose.model<IMeter>("User", MeterSchema);
