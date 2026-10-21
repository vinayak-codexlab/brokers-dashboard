import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { readOnlyPlugin } from "./plugins/readOnly.js";

const leadSubStageMappingSchema = new mongoose.Schema(
  {
    firm_id: { type: String, required: true },
    // String form of the parent leadstagemappings._id.
    stage_id: { type: String, required: true },
    name: { type: String, required: true },
    sortOrder: Number,
  },
  { collection: "leadsubstagemappings", timestamps: true }
);

leadSubStageMappingSchema.plugin(readOnlyPlugin);

export type ILeadSubStageMapping = InferSchemaType<typeof leadSubStageMappingSchema>;

export const LeadSubStageMapping =
  (mongoose.models.LeadSubStageMapping as Model<ILeadSubStageMapping> | undefined) ??
  mongoose.model<ILeadSubStageMapping>("LeadSubStageMapping", leadSubStageMappingSchema);
