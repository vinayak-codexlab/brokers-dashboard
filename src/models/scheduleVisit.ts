import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { readOnlyPlugin } from "./plugins/readOnly.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;

const visitStatusSchema = new mongoose.Schema(
  {
    code: Number,
    remark: String,
    timestamp: Date,
  },
  { _id: true }
);

const scheduleVisitSchema = new mongoose.Schema(
  {
    project_unit_id: ObjectId,
    // Broker id of the agent who booked the visit (string, not ObjectId).
    broker: String,
    firm_id: ObjectId,
    listing_broker_id: String,
    listing_firm_id: ObjectId,
    // "YYYY-MM-DD HH:mm:ss.SSS" strings, not Dates.
    visitTime: String,
    date: String,
    time: String,
    // Contact id; matches leads.contact_details.contact_id.
    contact: ObjectId,
    owner: ObjectId,
    name: { type: String, select: false },
    email: { type: String, select: false },
    phone: { type: String, select: false },
    status: { type: [visitStatusSchema], default: undefined },
    feedback: { type: [Mixed], default: undefined },
    // Snake-case timestamps written by the main app (declared as plain paths: this
    // service never writes, and custom-named `timestamps` breaks type inference).
    created_at: Date,
    updated_at: Date,
  },
  { collection: "schedule_visits" }
);

scheduleVisitSchema.plugin(readOnlyPlugin);

export type IScheduleVisit = InferSchemaType<typeof scheduleVisitSchema>;

export const ScheduleVisit =
  (mongoose.models.ScheduleVisit as Model<IScheduleVisit> | undefined) ??
  mongoose.model<IScheduleVisit>("ScheduleVisit", scheduleVisitSchema);
