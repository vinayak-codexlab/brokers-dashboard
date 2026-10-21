import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { readOnlyPlugin } from "./plugins/readOnly.js";

const leadStageMappingSchema = new mongoose.Schema(
  {
    // Stored as a string, while leads.firm_id is an ObjectId.
    firm_id: { type: String, required: true },
    name: { type: String, required: true },
    sortOrder: Number,
    // new | active | closed | junk — the only reliable way to categorise a stage.
    stage_type: String,
  },
  { collection: "leadstagemappings", timestamps: true }
);

leadStageMappingSchema.plugin(readOnlyPlugin);

export type ILeadStageMapping = InferSchemaType<typeof leadStageMappingSchema>;

export const LeadStageMapping =
  (mongoose.models.LeadStageMapping as Model<ILeadStageMapping> | undefined) ??
  mongoose.model<ILeadStageMapping>("LeadStageMapping", leadStageMappingSchema);
