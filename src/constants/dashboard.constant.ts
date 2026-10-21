import { env } from "../config/env.js";

export const STAGE_TYPES = ["new", "active", "closed", "junk"] as const;
export type StageType = (typeof STAGE_TYPES)[number];

export const STAGE_TYPE_LABELS: Record<StageType, string> = {
    new: "New",
    active: "Active",
    closed: "Closed",
    junk: "Junk",
};

export const PERIODS = ["6m", "12m", "custom"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_MONTHS: Record<Exclude<Period, "custom">, number> = { "6m": 6, "12m": 12 };
export const MAX_CUSTOM_MONTHS = 24;

export const DIMENSIONS = ["source", "intent", "property_type"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_FIELDS: Record<Dimension, string> = {
    source: "enquiry_overview.source",
    intent: "enquiry_overview.looking",
    property_type: "enquiry_overview.property_type",
};

export const ENTITIES = ["leads", "listings"] as const;
export type Entity = (typeof ENTITIES)[number];

export const INTENT_KEYS = ["buy", "sell", "rent", "lease_out"] as const;
export type IntentKey = (typeof INTENT_KEYS)[number];

export const INTENT_LABELS: Record<IntentKey | "other", string> = {
    buy: "To Buy",
    sell: "To Sell",
    rent: "Rent-In",
    lease_out: "Lease-Out",
    other: "Other",
};

// Raw `enquiry_overview.looking` values (lower-cased, "_"/"-" read as spaces) per intent.
export const INTENT_ALIASES: Record<IntentKey, string[]> = {
    buy: ["buy", "buyer", "to buy"],
    sell: ["sell", "seller", "to sell"],
    rent: ["rent", "rent in", "to rent"],
    lease_out: ["lease out", "to lease out"],
};

// Clearly-equivalent lead source spellings. Unlisted values keep their own bucket.
export const SOURCE_ALIASES: Record<string, string> = {
    "99 acres": "99acres",
    "99acres.com": "99acres",
    "magic bricks": "magicbricks",
    "magicbricks.com": "magicbricks",
    "no broker": "nobroker",
    "nobroker.in": "nobroker",
    "housing.com": "housing",
};

export const SOURCE_LABELS: Record<string, string> = {
    "99acres": "99acres",
    magicbricks: "MagicBricks",
    nobroker: "NoBroker",
    housing: "Housing.com",
};

export const AGEING_THRESHOLD_MONTHS = [1, 3, 6, 12] as const;
export const FORECAST_HORIZON_MONTHS = [1, 3, 6] as const;

// Listings in these states are not live, so they are excluded from pending/ageing.
// Only "delisted" has been observed in the sample data.
export const INACTIVE_LISTING_STATUSES = ["delisted"];

// Stage / sub-stage names that mark these pending-action buckets in firms that have them.
export const UNTOUCHED_NAME = /\buntouched\b/i;
export const UNQUALIFIED_NAME = /\b(un-?qualified|not qualified)\b/i;

export const LISTING_NO_VISIT_DAYS = 30;

export const PERFORMANCE_SORT_KEYS = ["totalLeads", "visitsDone", "dealsClosed", "revenueGenerated"] as const;
export const FORECAST_SORT_KEYS = ["activeLeads", "revenueWithin1m", "revenueWithin3m", "revenueWithin6m"] as const;
export const BREAKDOWN_SORT_KEYS = [
    "label",
    "newLeads",
    "activeLeads",
    "dealsClosed",
    "junkLeads",
    "archivedLeads",
    "totalLeads",
    "revenueGenerated",
] as const;

export const QUERY_MAX_TIME_MS = env.DASHBOARD_QUERY_MAX_TIME_MS;
export const MAPPING_CACHE_TTL_MS = 60_000;

export const REALISED_REVENUE_ENABLED = env.REALISED_REVENUE_PROXY;

export const VISIT_COMPLETED_CODES: number[] = env.VISIT_COMPLETED_STATUS_CODES
    .split(",")
    .map((code) => code.trim())
    .filter((code) => /^-?\d+$/.test(code))
    .map(Number);

export const UNSUPPORTED_REASONS = {
    realisedRevenue: "Realised revenue rule (closed-stage estimate) not approved",
    visits: "Completed-visit status codes not configured",
    untouched: "No 'Untouched' stage or sub-stage configured for this firm",
    unqualified: "No 'Unqualified' stage or sub-stage configured for this firm",
    notShared: "Listings carry no share timestamp to measure 14-day sharing",
} as const;
