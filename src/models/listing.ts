import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { readOnlyPlugin } from "./plugins/readOnly.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;

const listingImageSchema = new mongoose.Schema(
  {
    label: String,
    url: String,
  },
  { _id: true }
);

const listingDetailsSchema = new mongoose.Schema(
  {
    // e.g. "delisted"
    listing_status: String,
    listing_location: String,
    project: ObjectId,
    tower: ObjectId,
    unit_no: ObjectId,
    floor_no: Number,
    combine_unit_no: { type: [Mixed], default: undefined },
    UnitFloorPosition: String,
    towerHide: Boolean,
    unitHide: Boolean,
    floorHide: Boolean,
    building_status: String,
    building_age: Number,
    apartment_no: Number,
    area: Number,
    listing_name: String,
    entry_direction: String,
    exit_direction: String,
    view: String,
    project_type: String,
    unit_type: String,
    flooring: ObjectId,
    bhk: ObjectId,
    no_of_balconies: String,
    no_of_bathrooms: String,
    no_of_parkings: String,
    parking_details: String,
    // Visibility toggle only — carries no "shared at" timestamp.
    share: Boolean,
    projectHide: Boolean,
    age_of_property: String,
    completion_date: String,
    no_of_passenger_lifts: String,
    pets_allowed: String,
    property_status: String,
  },
  { _id: false }
);

const commercialDetailsSchema = new mongoose.Schema(
  {
    property_purpose: String,
    available_from: String,
    current_occupation_status: String,
    visit_day: String,
    particular_day: Mixed,
    start_time: String,
    end_time: String,
    monthly_rent: Number,
    discount_price: Number,
    security_amount: Number,
    avg_rate_per_sqft: Number,
    brokerage_charge: Number,
    furnishing: ObjectId,
    tenantsPreferred: ObjectId,
    move_in_charges: Number,
    availability_status: ObjectId,
    property_price: Number,
    sale_consideration: Number,
  },
  { _id: false }
);

const listingSchema = new mongoose.Schema(
  {
    listing_details: listingDetailsSchema,
    commercial_details: commercialDetailsSchema,
    people_associated: Mixed,
    // Both ids are strings here, unlike leads.
    broker_and_agent: {
      broker_id: String,
      firm_id: String,
    },
    buildstone: Mixed,
    amenities: { type: [Mixed], default: undefined },
    key_features: { type: [String], default: undefined },
    images: {
      apartment: { type: [listingImageSchema], default: undefined },
      ext_view_day: { type: [listingImageSchema], default: undefined },
      ext_view_night: { type: [listingImageSchema], default: undefined },
      amenities: { type: [listingImageSchema], default: undefined },
      plans: { type: [listingImageSchema], default: undefined },
    },
    seo: Mixed,
    furnishingAmenities: { type: [String], default: undefined },
    apartmentAmenities: { type: [String], default: undefined },
    video: String,
    listing_id: String,
    uniqueViews: { type: [Mixed], default: undefined },
    views: Number,
    lastUpdate: Date,
    broker_name: String,
    firm_name: String,
    listing_type: String,
    listing_address: {
      city: String,
      line_1: String,
      locality: String,
      pincode: String,
      region: String,
      subregion: String,
    },
  },
  { collection: "listings", timestamps: true }
);

listingSchema.plugin(readOnlyPlugin);

export type IListing = InferSchemaType<typeof listingSchema>;

export const Listing =
  (mongoose.models.Listing as Model<IListing> | undefined) ?? mongoose.model<IListing>("Listing", listingSchema);
