import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { readOnlyPlugin } from "./plugins/readOnly.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;

// status[] entries; newest is not guaranteed to be first, so read by timestamp.
const offerStatusSchema = new mongoose.Schema(
  {
    code: Number,
    remark: String,
    timestamp: Date,
  },
  { _id: true }
);

const rentEscalationSchema = new mongoose.Schema(
  {
    type: { type: String },
    value: String,
    rent: Number,
  },
  { _id: true }
);

const offerSchema = new mongoose.Schema(
  {
    project_unit_id: ObjectId,
    // Broker ids on offers are strings; firm ids are ObjectIds.
    broker: String,
    firm_id: ObjectId,
    listing_broker_id: String,
    listing_firm_id: ObjectId,
    // Not present on every offer; when present it is the lead _id as a string.
    lead_id: String,
    revisions: { type: [Mixed], default: undefined },
    // Contact id of the tenant/buyer; matches leads.contact_details.contact_id.
    tenant: ObjectId,
    rent: Number,
    security_deposit: Number,
    contract_period: String,
    rent_escalation: { type: [rentEscalationSchema], default: undefined },
    rent_start_date: String,
    monthly_due_date: String,
    lock_in_period: String,
    notice_period: String,
    requests: { type: [Mixed], default: undefined },
    lease_type: String,
    company: Mixed,
    // Holds tenant names, phones and emails — never selected by the dashboard.
    personal: { type: Mixed, select: false },
    use_of_premise: Mixed,
    occupant_details: { type: [Mixed], default: undefined, select: false },
    status: { type: [offerStatusSchema], default: undefined },
    name: { type: String, select: false },
    phone: { type: String, select: false },
    offer_status: String,
  },
  { collection: "offers", timestamps: true }
);

offerSchema.plugin(readOnlyPlugin);

export type IOffer = InferSchemaType<typeof offerSchema>;

export const Offer =
  (mongoose.models.Offer as Model<IOffer> | undefined) ?? mongoose.model<IOffer>("Offer", offerSchema);
