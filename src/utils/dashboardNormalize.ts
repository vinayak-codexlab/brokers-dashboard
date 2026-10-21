import { INTENT_ALIASES, INTENT_LABELS, SOURCE_ALIASES, SOURCE_LABELS } from "../constants/dashboard.constant.js";
import type { Dimension, IntentKey } from "../constants/dashboard.constant.js";

// Normalisation is display-side only: stored values are never rewritten.

export type CategoryKey = { key: string; label: string };

export const UNKNOWN_CATEGORY: CategoryKey = { key: "unknown", label: "Unknown" };

// Zero-width characters and emoji variation selectors seen in values like "Hot️".
const INVISIBLE_CHARS = /[​-‍⁠︀-️﻿]/g;

export const cleanText = (value: unknown): string => {
    if (typeof value !== "string") return "";
    return value.normalize("NFKC").replace(INVISIBLE_CHARS, "").replace(/\s+/g, " ").trim().toLowerCase();
};

const titleCase = (value: string) => value.replace(/(^|[\s/(-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());

const INTENT_BY_ALIAS = new Map<string, IntentKey>(
    (Object.entries(INTENT_ALIASES) as [IntentKey, string[]][]).flatMap(([key, aliases]) =>
        aliases.map((alias) => [alias, key] as const),
    ),
);

export const normalizeIntent = (value: unknown): CategoryKey => {
    const cleaned = cleanText(value).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned) return UNKNOWN_CATEGORY;
    const key = INTENT_BY_ALIAS.get(cleaned);
    return key ? { key, label: INTENT_LABELS[key] } : { key: "other", label: INTENT_LABELS.other };
};

export const normalizeSource = (value: unknown): CategoryKey => {
    const cleaned = cleanText(value);
    if (!cleaned) return UNKNOWN_CATEGORY;
    const key = SOURCE_ALIASES[cleaned] ?? cleaned;
    return { key, label: SOURCE_LABELS[key] ?? titleCase(key) };
};

export const normalizePropertyType = (value: unknown): CategoryKey => {
    const cleaned = cleanText(value);
    if (!cleaned) return UNKNOWN_CATEGORY;
    return { key: cleaned, label: titleCase(cleaned) };
};

export const normalizeDimension = (dimension: Dimension, value: unknown): CategoryKey => {
    if (dimension === "intent") return normalizeIntent(value);
    if (dimension === "source") return normalizeSource(value);
    return normalizePropertyType(value);
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Mongo filter matching every raw `looking` spelling of an intent. */
export const intentFilter = (intent: IntentKey) => {
    const variants = INTENT_ALIASES[intent].map((alias) => alias.split(" ").map(escapeRegex).join("[\\s_-]+"));
    return { $regex: new RegExp(`^\\s*(?:${variants.join("|")})\\s*$`, "i") };
};

/** Mongo filter for a normalised property type (case/space-insensitive exact match). */
export const propertyTypeFilter = (propertyType: string) => {
    if (propertyType === UNKNOWN_CATEGORY.key) return { $in: [null, ""] };
    return { $regex: new RegExp(`^\\s*${escapeRegex(propertyType).replace(/ /g, "\\s+")}\\s*$`, "i") };
};

/** sub_stage values may be "", an id, an ObjectId, an array, or "id1[/]id2". */
export const splitSubStageIds = (value: unknown): string[] => {
    if (value == null) return [];
    if (Array.isArray(value)) return value.flatMap(splitSubStageIds);
    const raw = typeof value === "string" ? value : String(value);
    return raw
        .split(/\[\/\]|[/,]/)
        .map((part) => part.trim())
        .filter((part) => /^[a-f\d]{24}$/i.test(part))
        .map((part) => part.toLowerCase());
};
