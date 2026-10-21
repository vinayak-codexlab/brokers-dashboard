import { z } from "zod";
import {
    BREAKDOWN_SORT_KEYS,
    DIMENSIONS,
    ENTITIES,
    FORECAST_SORT_KEYS,
    INTENT_KEYS,
    MAX_CUSTOM_MONTHS,
    PERFORMANCE_SORT_KEYS,
    PERIODS,
    STAGE_TYPES,
} from "../constants/dashboard.constant.js";
import { customRangeMonths } from "../utils/dashboardDate.js";

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const isoDay = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be in YYYY-MM-DD format")
    .refine((value) => {
        const date = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
    }, "Invalid date");

const sortDir = z.enum(["asc", "desc"]).default("desc");
const page = z.coerce.number().int().min(1).max(10_000).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);

const agentId = objectIdSchema.optional();

const intent = z
    .enum(["all", ...INTENT_KEYS, "lease-out"])
    .default("all")
    .transform((value) => (value === "lease-out" ? "lease_out" : value));

const propertyType = z.string().trim().toLowerCase().min(1).max(60).default("all");

const periodShape = {
    period: z.enum(PERIODS).default("6m"),
    from: isoDay.optional(),
    to: isoDay.optional(),
};

const filterShape = { ...periodShape, propertyType, intent, agentId };

const refinePeriod = (value: { period: string; from?: string | undefined; to?: string | undefined }, ctx: z.RefinementCtx) => {
    if (value.period !== "custom") return;
    if (!value.from || !value.to) {
        ctx.addIssue({ code: "custom", message: "Custom period requires from and to (YYYY-MM-DD)" });
        return;
    }
    if (value.from > value.to) {
        ctx.addIssue({ code: "custom", message: "from must be on or before to" });
        return;
    }
    if (customRangeMonths(value.from, value.to) > MAX_CUSTOM_MONTHS) {
        ctx.addIssue({ code: "custom", message: `Custom period cannot exceed ${MAX_CUSTOM_MONTHS} months` });
    }
};

export const revenueQuerySchema = z.object(filterShape).superRefine(refinePeriod);

export const pipelineQuerySchema = z
    .object({ ...filterShape, stageType: z.enum(STAGE_TYPES).default("new") })
    .superRefine(refinePeriod);

export const categoriesQuerySchema = z
    .object({ ...filterShape, dimension: z.enum(DIMENSIONS).default("intent") })
    .superRefine(refinePeriod);

export const breakdownQuerySchema = z
    .object({
        ...filterShape,
        dimension: z.enum(DIMENSIONS).default("source"),
        sortBy: z.enum(BREAKDOWN_SORT_KEYS).default("totalLeads"),
        sortDir,
        page,
        limit,
    })
    .superRefine(refinePeriod);

export const pendingActionsQuerySchema = z.object({
    entity: z.enum(ENTITIES).default("leads"),
    agentId,
});

export const ageingQuerySchema = z.object({
    entity: z.enum(ENTITIES).default("leads"),
    agentId,
});

export const performanceQuerySchema = z
    .object({
        ...filterShape,
        sortBy: z.enum(PERFORMANCE_SORT_KEYS).default("totalLeads"),
        sortDir,
        page,
        limit,
    })
    .superRefine(refinePeriod);

export const forecastQuerySchema = z.object({
    propertyType,
    intent,
    agentId,
    sortBy: z.enum(FORECAST_SORT_KEYS).default("activeLeads"),
    sortDir,
    page,
    limit,
});

export type RevenueQuery = z.infer<typeof revenueQuerySchema>;
export type PipelineQuery = z.infer<typeof pipelineQuerySchema>;
export type CategoriesQuery = z.infer<typeof categoriesQuerySchema>;
export type BreakdownQuery = z.infer<typeof breakdownQuerySchema>;
export type PendingActionsQuery = z.infer<typeof pendingActionsQuerySchema>;
export type AgeingQuery = z.infer<typeof ageingQuerySchema>;
export type PerformanceQuery = z.infer<typeof performanceQuerySchema>;
export type ForecastQuery = z.infer<typeof forecastQuerySchema>;
