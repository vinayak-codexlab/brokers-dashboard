import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { readOnlyPlugin } from "./plugins/readOnly.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;

// Contact fields are stored hashed/encrypted. The dashboard never returns them, so
// they are excluded from any find() by default.
const contactDetailsSchema = new mongoose.Schema(
  {
    contactName: { type: String, select: false },
    mobileNo: { type: String, select: false },
    full_mobile_no: { type: String, select: false },
    alternate_MobileNo: { type: String, select: false },
    email: { type: String, select: false },
    company_name: String,
    designation: String,
    profile_link: String,
    occupation_status: String,
    contact_id: ObjectId,
  },
  { _id: false }
);

const enquiryOverviewSchema = new mongoose.Schema(
  {
    source: String,
    source_details: String,
    property_type: String,
    looking: String,
  },
  { _id: false }
);

const buildingAndLocationSchema = new mongoose.Schema(
  {
    city: String,
    project_status: String,
    project_age: String,
    project_type: String,
    project_name: String,
    building_name: String,
    tower_name: String,
    unit: String,
    floor_number: String,
    location: {
      region: String,
      sub_region: String,
      locality: String,
    },
  },
  { _id: false }
);

const enquiryDetailsSchema = new mongoose.Schema(
  {
    property_sub_type: String,
    seating_capacity: String,
    bhk: String,
    price_min: Number,
    price_max: Number,
    security_deposit: Number,
    lease_period: String,
    lock_in_period: String,
    area: Mixed,
    area_min: String,
    area_max: String,
    area_type: String,
  },
  { _id: false }
);

const specificationsSchema = new mongoose.Schema(
  {
    furnishing: String,
    property_age: String,
    available_from: Mixed,
    avalibility_status: Mixed,
    pantry: String,
    ceiling_height: String,
    no_of_bathrooms: String,
    no_of_parking: String,
    no_of_conference_halls: String,
    no_of_balconies: String,
    view: String,
    main_door_exit: String,
    floor_range: String,
    apartment_total: Mixed,
    notes: String,
    main_door_entry: { type: [Mixed], default: undefined },
  },
  { _id: false }
);

const internalInfoSchema = new mongoose.Schema(
  {
    estimated_transaction_value: Number,
    estimated_revenue: Number,
    estimated_closure_date: Date,
  },
  { _id: false }
);

const leadSchema = new mongoose.Schema(
  {
    contact_details: contactDetailsSchema,
    enquiry_overview: enquiryOverviewSchema,
    building_and_location: buildingAndLocationSchema,
    enquiry_details: enquiryDetailsSchema,
    specifications: specificationsSchema,
    internal_info: internalInfoSchema,
    flag: String,
    stage: ObjectId,
    // { [stageId: string]: subStageId | "" | "id1[/]id2" } — keys and values are strings.
    sub_stage: Mixed,
    firm_id: ObjectId,
    broker_id: ObjectId,
    // Canonical owner of the lead for dashboard visibility (not broker_id).
    assign_to: ObjectId,
    // 1 = live, 0 = archived.
    status: Number,
    linked_property: { type: [Mixed], default: undefined },
    assigned_on: Date,
    local_shared_listings: { type: [ObjectId], default: undefined },
    local_shared_projects: { type: [ObjectId], default: undefined },
    lastFetchedTransaction: Date,
    leadAddedAt: Date,
    network_matching: String,
  },
  { collection: "leads", timestamps: true }
);

leadSchema.plugin(readOnlyPlugin);

export type ILead = InferSchemaType<typeof leadSchema>;

export const Lead =
  (mongoose.models.Lead as Model<ILead> | undefined) ?? mongoose.model<ILead>("Lead", leadSchema);
