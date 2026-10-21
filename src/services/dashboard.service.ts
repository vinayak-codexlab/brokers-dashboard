import { Types } from "mongoose";
import type { Model, PipelineStage } from "mongoose";
import { Lead } from "../models/lead.js";
import { LeadStageMapping } from "../models/leadStageMapping.js";
import { LeadSubStageMapping } from "../models/leadSubStageMapping.js";
import { Offer } from "../models/offer.js";
import { ScheduleVisit } from "../models/scheduleVisit.js";
import { Listing } from "../models/listing.js";
import { ApiError } from "../utils/apiError.js";
import {
    AGEING_THRESHOLD_MONTHS,
    DIMENSION_FIELDS,
    DIMENSIONS,
    ENTITIES,
    FORECAST_HORIZON_MONTHS,
    INACTIVE_LISTING_STATUSES,
    INTENT_KEYS,
    INTENT_LABELS,
    LISTING_NO_VISIT_DAYS,
    MAPPING_CACHE_TTL_MS,
    PERIODS,
    QUERY_MAX_TIME_MS,
    REALISED_REVENUE_ENABLED,
    STAGE_TYPE_LABELS,
    STAGE_TYPES,
    UNQUALIFIED_NAME,
    UNSUPPORTED_REASONS,
    UNTOUCHED_NAME,
    VISIT_COMPLETED_CODES,
} from "../constants/dashboard.constant.js";
import type { IntentKey, StageType } from "../constants/dashboard.constant.js";
import {
    IST_TIMEZONE,
    addDays,
    addIstMonths,
    buildPeriodWindow,
    istDateString,
    istDayStart,
    toIsoIst,
} from "../utils/dashboardDate.js";
import type { DateWindow } from "../utils/dashboardDate.js";
import {
    UNKNOWN_CATEGORY,
    intentFilter,
    normalizeDimension,
    normalizePropertyType,
    propertyTypeFilter,
    splitSubStageIds,
} from "../utils/dashboardNormalize.js";
import type {
    AgeingQuery,
    BreakdownQuery,
    CategoriesQuery,
    ForecastQuery,
    PendingActionsQuery,
    PerformanceQuery,
    PipelineQuery,
    RevenueQuery,
} from "../validations/dashboard.validation.js";

type AuthContext = {
    broker_id: string;
    firm_id: string;
    isOwner?: boolean;
};

type Scope = {
    firmId: Types.ObjectId;
    firmIdStr: string;
    mode: "firm" | "agent";
    /** null = every lead in the firm; otherwise only leads whose assign_to is in this list. */
    agentIds: Types.ObjectId[] | null;
    /** Agent explicitly selected by a firm owner, if any. */
    agentId: string | null;
};

type LeadFilters = {
    window?: DateWindow | undefined;
    intent?: string | undefined;
    propertyType?: string | undefined;
};

type StageInfo = { id: string; name: string; stageType: StageType | null; sortOrder: number };
type SubStageInfo = { id: string; stageId: string; name: string; sortOrder: number };
type FirmStages = { list: StageInfo[]; byId: Map<string, StageInfo>; idsByType: Record<StageType, Types.ObjectId[]> };
type FirmSubStages = { byId: Map<string, SubStageInfo>; byStage: Map<string, SubStageInfo[]> };

/** Every scoped lead lands in exactly one bucket, so the buckets always reconcile. */
type Bucket = StageType | "archived" | "unmapped" | "otherStatus";
type BucketCounts = Record<Bucket, number>;

type AgentRef = { agentId: string };

type PendingItem = {
    key: string;
    label: string;
    count: number | null;
    supported: boolean;
    reason: string | null;
    definition: string;
};

const OBJECT_ID_HEX = /^[a-f\d]{24}$/i;

const LEAD_DATE = { $ifNull: ["$leadAddedAt", "$createdAt"] };
const CLOSURE_DATE = "$internal_info.estimated_closure_date";
const ESTIMATED_REVENUE = "$internal_info.estimated_revenue";
const NUMERIC_REVENUE = { $cond: [{ $isNumber: ESTIMATED_REVENUE }, ESTIMATED_REVENUE, 0] };

// Latest entry of a status[] history by timestamp (array order is not relied upon).
const LATEST_STATUS = {
    $reduce: {
        input: { $ifNull: ["$status", []] },
        initialValue: null,
        in: {
            $cond: [
                { $or: [{ $eq: ["$$value", null] }, { $gt: ["$$this.timestamp", "$$value.timestamp"] }] },
                "$$this",
                "$$value",
            ],
        },
    },
};

const emptyBuckets = (): BucketCounts => ({
    new: 0,
    active: 0,
    closed: 0,
    junk: 0,
    archived: 0,
    unmapped: 0,
    otherStatus: 0,
});

/** Leads may hold the stage as an ObjectId or (legacy) a string; match both. */
const withIdForms = (ids: Types.ObjectId[]) => ids.flatMap((id) => [id, id.toHexString()]);

const toObjectIds = (values: unknown[]) =>
    values
        .map((value) => (value == null ? "" : String(value)))
        .filter((value) => OBJECT_ID_HEX.test(value))
        .map((value) => new Types.ObjectId(value));

const percentage = (count: number, total: number) => (total > 0 ? Math.round((count / total) * 1000) / 10 : 0);

const compareValues = (a: unknown, b: unknown) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a ?? "").localeCompare(String(b ?? ""));
};

/** Sort in memory (null values last), deterministic tie-break, then paginate. */
const sortAndPage = <T extends Record<string, unknown>>(
    rows: T[],
    sortBy: string,
    sortDir: "asc" | "desc",
    tieBy: string,
    page: number,
    limit: number,
) => {
    const sign = sortDir === "asc" ? 1 : -1;
    const sorted = [...rows].sort((x, y) => {
        const a = x[sortBy];
        const b = y[sortBy];
        if (a == null || b == null) {
            if (a == null && b == null) return compareValues(x[tieBy], y[tieBy]);
            return a == null ? 1 : -1;
        }
        return sign * compareValues(a, b) || compareValues(x[tieBy], y[tieBy]);
    });
    const start = (page - 1) * limit;
    return {
        rows: sorted.slice(start, start + limit),
        pagination: { page, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit) },
    };
};

// In-process, per-firm mapping cache (read-only data, never cross-firm).
const mappingCache = new Map<string, { expiresAt: number; value: Promise<unknown> }>();
const MAX_CACHE_ENTRIES = 2000;

const cached = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const hit = mappingCache.get(key);
    if (hit && hit.expiresAt > now) return hit.value as Promise<T>;
    if (mappingCache.size >= MAX_CACHE_ENTRIES) mappingCache.clear();
    const value = load();
    mappingCache.set(key, { expiresAt: now + MAPPING_CACHE_TTL_MS, value });
    value.catch(() => mappingCache.delete(key));
    return value;
};

class DashboardService {
    // ---------------------------------------------------------------------------
    // Scope, mappings and shared query helpers
    // ---------------------------------------------------------------------------

    /**
     * Firm and agent scope come only from the verified token. A firm owner may narrow to
     * one agent; everyone else is pinned to their own leads. Because every query also
     * filters by the caller's firm, an owner passing another firm's agent id sees nothing.
     */
    private resolveScope(auth: AuthContext, agentId?: string | undefined): Scope {
        if (!OBJECT_ID_HEX.test(auth.firm_id) || !OBJECT_ID_HEX.test(auth.broker_id)) {
            throw new ApiError(401, "Invalid authentication context");
        }
        const firmId = new Types.ObjectId(auth.firm_id);
        if (!auth.isOwner) {
            if (agentId && agentId.toLowerCase() !== auth.broker_id.toLowerCase()) {
                throw new ApiError(403, "Not permitted to view this agent");
            }
            return {
                firmId,
                firmIdStr: auth.firm_id,
                mode: "agent",
                agentIds: [new Types.ObjectId(auth.broker_id)],
                agentId: null,
            };
        }
        return {
            firmId,
            firmIdStr: auth.firm_id,
            mode: "firm",
            agentIds: agentId ? [new Types.ObjectId(agentId)] : null,
            agentId: agentId ?? null,
        };
    }

    private aggregate<T>(model: Model<any>, pipeline: PipelineStage[]): Promise<T[]> {
        return model.aggregate<T>(pipeline).option({ maxTimeMS: QUERY_MAX_TIME_MS, allowDiskUse: false }).exec();
    }

    private countLeads(filter: Record<string, unknown>) {
        return Lead.countDocuments(filter).maxTimeMS(QUERY_MAX_TIME_MS).exec();
    }

    private leadMatch(scope: Scope, filters: LeadFilters = {}) {
        const match: Record<string, unknown> = { firm_id: scope.firmId };
        if (scope.agentIds) match.assign_to = { $in: scope.agentIds };
        const and: Record<string, unknown>[] = [];
        if (filters.window) {
            const range = { $gte: filters.window.from, $lt: filters.window.to };
            // Acquisition date = leadAddedAt ?? createdAt, written index-friendly.
            and.push({ $or: [{ leadAddedAt: range }, { leadAddedAt: null, createdAt: range }] });
        }
        if (filters.intent && filters.intent !== "all") {
            and.push({ "enquiry_overview.looking": intentFilter(filters.intent as IntentKey) });
        }
        if (filters.propertyType && filters.propertyType !== "all") {
            and.push({ "enquiry_overview.property_type": propertyTypeFilter(filters.propertyType) });
        }
        if (and.length > 0) match.$and = and;
        return match;
    }

    private getFirmStages(firmIdStr: string): Promise<FirmStages> {
        return cached(`stages:${firmIdStr}`, async () => {
            const docs = await LeadStageMapping.find({ firm_id: firmIdStr })
                .select({ name: 1, sortOrder: 1, stage_type: 1 })
                .sort({ sortOrder: 1, _id: 1 })
                .maxTimeMS(QUERY_MAX_TIME_MS)
                .lean();
            const idsByType: Record<StageType, Types.ObjectId[]> = { new: [], active: [], closed: [], junk: [] };
            const list: StageInfo[] = [];
            const byId = new Map<string, StageInfo>();
            for (const doc of docs) {
                const rawType = String(doc.stage_type ?? "").trim().toLowerCase();
                const stageType = (STAGE_TYPES as readonly string[]).includes(rawType) ? (rawType as StageType) : null;
                const info: StageInfo = {
                    id: doc._id.toHexString(),
                    name: doc.name,
                    stageType,
                    sortOrder: doc.sortOrder ?? 0,
                };
                list.push(info);
                byId.set(info.id, info);
                if (stageType) idsByType[stageType].push(doc._id);
            }
            return { list, byId, idsByType };
        });
    }

    private getFirmSubStages(firmIdStr: string): Promise<FirmSubStages> {
        return cached(`substages:${firmIdStr}`, async () => {
            const docs = await LeadSubStageMapping.find({ firm_id: firmIdStr })
                .select({ stage_id: 1, name: 1, sortOrder: 1 })
                .sort({ sortOrder: 1, _id: 1 })
                .maxTimeMS(QUERY_MAX_TIME_MS)
                .lean();
            const byId = new Map<string, SubStageInfo>();
            const byStage = new Map<string, SubStageInfo[]>();
            for (const doc of docs) {
                const info: SubStageInfo = {
                    id: doc._id.toHexString(),
                    stageId: String(doc.stage_id).toLowerCase(),
                    name: doc.name,
                    sortOrder: doc.sortOrder ?? 0,
                };
                byId.set(info.id, info);
                const siblings = byStage.get(info.stageId) ?? [];
                siblings.push(info);
                byStage.set(info.stageId, siblings);
            }
            return { byId, byStage };
        });
    }

    private classify(stages: FirmStages, stage: unknown, status: unknown): Bucket {
        if (status === 0) return "archived";
        if (status !== 1) return "otherStatus";
        const info = stage == null ? undefined : stages.byId.get(String(stage).toLowerCase());
        if (!info || !info.stageType) return "unmapped";
        return info.stageType;
    }

    private openStageIds(stages: FirmStages) {
        return [...stages.idsByType.new, ...stages.idsByType.active];
    }

    /**
     * Agents visible to the caller. Owners see every agent who has ever been assigned a
     * lead in the firm (so zero-lead-in-period agents still appear); agents see themselves.
     */
    private async getRoster(scope: Scope, auth: AuthContext): Promise<AgentRef[]> {
        let ids: string[];
        if (scope.agentIds) {
            ids = scope.agentIds.map((id) => id.toHexString());
        } else {
            const distinct = await Lead.distinct("assign_to", { firm_id: scope.firmId }).maxTimeMS(QUERY_MAX_TIME_MS).exec();
            ids = [...new Set(toObjectIds(distinct).map((id) => id.toHexString()))];
        }
        if (ids.length === 0) ids = [auth.broker_id.toLowerCase()];
        return ids.map((agentId) => ({ agentId }));
    }

    /** Visits whose latest status is a configured "completed" code, in the window. */
    private async completedVisitsByAgent(scope: Scope, window: DateWindow): Promise<Map<string, number> | null> {
        if (VISIT_COMPLETED_CODES.length === 0) return null;
        const match: Record<string, unknown> = {
            firm_id: scope.firmId,
            "status.code": { $in: VISIT_COMPLETED_CODES },
        };
        if (scope.agentIds) match.broker = { $in: scope.agentIds.map((id) => id.toHexString()) };
        const rows = await this.aggregate<{ _id: unknown; count: number }>(ScheduleVisit, [
            { $match: match },
            { $project: { broker: 1, latest: LATEST_STATUS } },
            {
                $match: {
                    "latest.code": { $in: VISIT_COMPLETED_CODES },
                    "latest.timestamp": { $gte: window.from, $lt: window.to },
                },
            },
            { $group: { _id: "$broker", count: { $sum: 1 } } },
        ]);
        return new Map(rows.map((row) => [String(row._id).toLowerCase(), row.count]));
    }

    private envelope<T>(data: T, scope: Scope, extra: Record<string, unknown> = {}) {
        return {
            data,
            meta: {
                asOf: toIsoIst(new Date()),
                timezone: IST_TIMEZONE,
                scope: scope.mode,
                agentId: scope.agentId,
                ...extra,
            },
        };
    }

    // ---------------------------------------------------------------------------
    // 01 · GET /meta
    // ---------------------------------------------------------------------------

    async getMeta(auth: AuthContext) {
        const scope = this.resolveScope(auth);
        const [stages, subStages, agents, rawPropertyTypes] = await Promise.all([
            this.getFirmStages(scope.firmIdStr),
            this.getFirmSubStages(scope.firmIdStr),
            this.getRoster(scope, auth),
            Lead.distinct("enquiry_overview.property_type", { firm_id: scope.firmId }).maxTimeMS(QUERY_MAX_TIME_MS).exec(),
        ]);

        const propertyTypes = new Map<string, string>();
        for (const value of rawPropertyTypes) {
            const category = normalizePropertyType(value);
            if (category.key !== UNKNOWN_CATEGORY.key) propertyTypes.set(category.key, category.label);
        }

        return this.envelope(
            {
                scope: { mode: scope.mode, userId: auth.broker_id, isOwner: auth.isOwner === true },
                firm: { id: scope.firmIdStr },
                availableAgents: agents,
                stageTypes: STAGE_TYPES.map((key) => ({ key, label: STAGE_TYPE_LABELS[key] })),
                stages: stages.list.map((stage) => ({
                    stageId: stage.id,
                    name: stage.name,
                    stageType: stage.stageType,
                    sortOrder: stage.sortOrder,
                    subStages: (subStages.byStage.get(stage.id) ?? []).map((sub) => ({
                        subStageId: sub.id,
                        name: sub.name,
                        sortOrder: sub.sortOrder,
                    })),
                })),
                filters: {
                    periods: PERIODS,
                    intents: [{ key: "all", label: "All" }, ...INTENT_KEYS.map((key) => ({ key, label: INTENT_LABELS[key] }))],
                    propertyTypes: [
                        { key: "all", label: "All" },
                        ...[...propertyTypes].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
                    ],
                    dimensions: DIMENSIONS,
                    entities: ENTITIES,
                },
                features: {
                    realisedRevenue: REALISED_REVENUE_ENABLED,
                    visits: VISIT_COMPLETED_CODES.length > 0,
                },
            },
            scope,
        );
    }

    // ---------------------------------------------------------------------------
    // 02 · GET /revenue
    // ---------------------------------------------------------------------------

    async getRevenue(auth: AuthContext, query: RevenueQuery) {
        const scope = this.resolveScope(auth, query.agentId);
        const window = buildPeriodWindow(query);
        const stages = await this.getFirmStages(scope.firmIdStr);
        const openIds = this.openStageIds(stages);
        const closedIds = stages.idsByType.closed;
        const stageIds = REALISED_REVENUE_ENABLED ? [...openIds, ...closedIds] : openIds;

        const hasDate = { $eq: [{ $type: CLOSURE_DATE }, "date"] };
        const inWindow = { $and: [hasDate, { $gte: [CLOSURE_DATE, window.from] }, { $lt: [CLOSURE_DATE, window.to] }] };

        const rows = stageIds.length === 0 ? [] : await this.aggregate<{
            _id: { kind: "open" | "closed"; month: string | null; hasDate: boolean; hasAmount: boolean };
            amount: number;
            count: number;
        }>(Lead, [
            {
                $match: {
                    ...this.leadMatch(scope, { intent: query.intent, propertyType: query.propertyType }),
                    status: 1,
                    stage: { $in: withIdForms(stageIds) },
                },
            },
            {
                $group: {
                    _id: {
                        kind: { $cond: [{ $in: ["$stage", withIdForms(closedIds)] }, "closed", "open"] },
                        month: {
                            $cond: [inWindow, { $dateToString: { format: "%Y-%m", date: CLOSURE_DATE, timezone: IST_TIMEZONE } }, null],
                        },
                        hasDate,
                        hasAmount: { $isNumber: ESTIMATED_REVENUE },
                    },
                    amount: { $sum: NUMERIC_REVENUE },
                    count: { $sum: 1 },
                },
            },
        ]);

        const fold = (kind: "open" | "closed") => {
            const byMonth = new Map(window.months.map((month) => [month, 0]));
            let total = 0;
            let leadCount = 0;
            let missingAmountCount = 0;
            let missingDateCount = 0;
            for (const row of rows) {
                if (row._id.kind !== kind) continue;
                if (!row._id.hasDate) {
                    if (row._id.hasAmount) missingDateCount += row.count;
                    continue;
                }
                if (!row._id.month) continue;
                if (!row._id.hasAmount) {
                    missingAmountCount += row.count;
                    continue;
                }
                byMonth.set(row._id.month, (byMonth.get(row._id.month) ?? 0) + row.amount);
                total += row.amount;
                leadCount += row.count;
            }
            return {
                total,
                leadCount,
                months: [...byMonth].map(([month, amount]) => ({ month, amount })),
                dataQuality: { missingAmountCount, missingDateCount },
            };
        };

        const estimated = fold("open");
        // Provisional proxy: estimated_revenue of closed-stage leads, bucketed by their
        // estimated closure date. Not audited realised revenue.
        const realised = REALISED_REVENUE_ENABLED
            ? { supported: true, basis: "closed_stage_estimate", reason: null, ...fold("closed") }
            : { supported: false, basis: null, reason: UNSUPPORTED_REASONS.realisedRevenue, total: null, leadCount: null, months: [], dataQuality: null };

        return this.envelope(
            {
                realised,
                estimatedClosure: {
                    supported: true,
                    basis: "open_leads_by_estimated_closure_date",
                    total: estimated.total,
                    leadCount: estimated.leadCount,
                    months: estimated.months,
                    dataQuality: estimated.dataQuality,
                },
            },
            scope,
            { period: query.period, from: toIsoIst(window.from), to: toIsoIst(window.to), currency: "INR" },
        );
    }

    // ---------------------------------------------------------------------------
    // 03 · GET /pipeline
    // ---------------------------------------------------------------------------

    async getPipeline(auth: AuthContext, query: PipelineQuery) {
        const scope = this.resolveScope(auth, query.agentId);
        const window = buildPeriodWindow(query);
        const [stages, subStages] = await Promise.all([
            this.getFirmStages(scope.firmIdStr),
            this.getFirmSubStages(scope.firmIdStr),
        ]);
        const match = this.leadMatch(scope, { window, intent: query.intent, propertyType: query.propertyType });
        const selectedIds = stages.idsByType[query.stageType];

        const [stageRows, subRows] = await Promise.all([
            this.aggregate<{ _id: { stage?: unknown; status?: unknown }; count: number }>(Lead, [
                { $match: match },
                { $group: { _id: { stage: "$stage", status: "$status" }, count: { $sum: 1 } } },
            ]),
            selectedIds.length === 0
                ? Promise.resolve([])
                : this.aggregate<{ _id: { stage: unknown; sub?: unknown }; count: number }>(Lead, [
                    { $match: { ...match, status: 1, stage: { $in: withIdForms(selectedIds) } } },
                    {
                        // sub_stage is { [stageId]: subStageId }; read the entry for the current stage.
                        $project: {
                            stage: 1,
                            current: {
                                $arrayElemAt: [
                                    {
                                        $filter: {
                                            input: {
                                                $cond: [{ $eq: [{ $type: "$sub_stage" }, "object"] }, { $objectToArray: "$sub_stage" }, []],
                                            },
                                            as: "pair",
                                            cond: { $eq: [{ $toLower: "$$pair.k" }, { $toLower: { $toString: "$stage" } }] },
                                        },
                                    },
                                    0,
                                ],
                            },
                        },
                    },
                    { $group: { _id: { stage: "$stage", sub: "$current.v" }, count: { $sum: 1 } } },
                ]),
        ]);

        const buckets = emptyBuckets();
        const perStage = new Map<string, number>();
        for (const row of stageRows) {
            const bucket = this.classify(stages, row._id.stage, row._id.status);
            buckets[bucket] += row.count;
            if (bucket === query.stageType) {
                const key = String(row._id.stage).toLowerCase();
                perStage.set(key, (perStage.get(key) ?? 0) + row.count);
            }
        }

        type SubTally = { occurrences: Map<string, number>; withSubStage: number; noSubStage: number; unmappedSubStage: number };
        const subTally = new Map<string, SubTally>();
        for (const row of subRows) {
            const stageId = String(row._id.stage).toLowerCase();
            const tally = subTally.get(stageId) ?? { occurrences: new Map(), withSubStage: 0, noSubStage: 0, unmappedSubStage: 0 };
            const ids = splitSubStageIds(row._id.sub);
            if (ids.length === 0) {
                tally.noSubStage += row.count;
            } else {
                tally.withSubStage += row.count;
                for (const id of ids) {
                    const info = subStages.byId.get(id);
                    if (info && info.stageId === stageId) {
                        tally.occurrences.set(id, (tally.occurrences.get(id) ?? 0) + row.count);
                    } else {
                        tally.unmappedSubStage += row.count;
                    }
                }
            }
            subTally.set(stageId, tally);
        }

        const segments = stages.list
            .filter((stage) => stage.stageType === query.stageType)
            .map((stage) => {
                const tally = subTally.get(stage.id);
                return {
                    stageId: stage.id,
                    label: stage.name,
                    sortOrder: stage.sortOrder,
                    count: perStage.get(stage.id) ?? 0,
                    // Occurrence counts: a lead with several sub-stages counts once per sub-stage.
                    subStages: (subStages.byStage.get(stage.id) ?? []).map((sub) => ({
                        subStageId: sub.id,
                        label: sub.name,
                        count: tally?.occurrences.get(sub.id) ?? 0,
                    })),
                    leadsWithSubStage: tally?.withSubStage ?? 0,
                    leadsWithoutSubStage: tally?.noSubStage ?? 0,
                    unmappedSubStageCount: tally?.unmappedSubStage ?? 0,
                };
            });

        return this.envelope(
            {
                tabs: { new: buckets.new, active: buckets.active, closed: buckets.closed, junk: buckets.junk },
                selectedStageType: query.stageType,
                total: buckets[query.stageType],
                segments,
                archivedCount: buckets.archived,
                unmappedCount: buckets.unmapped,
            },
            scope,
            {
                period: query.period,
                from: toIsoIst(window.from),
                to: toIsoIst(window.to),
                dataQuality: { unmappedStageCount: buckets.unmapped, otherStatusCount: buckets.otherStatus },
            },
        );
    }

    // ---------------------------------------------------------------------------
    // 04 · GET /categories
    // ---------------------------------------------------------------------------

    async getCategories(auth: AuthContext, query: CategoriesQuery) {
        const scope = this.resolveScope(auth, query.agentId);
        const window = buildPeriodWindow(query);
        const field = DIMENSION_FIELDS[query.dimension];

        const rows = await this.aggregate<{ _id: unknown; count: number }>(Lead, [
            {
                $match: {
                    ...this.leadMatch(scope, { window, intent: query.intent, propertyType: query.propertyType }),
                    status: 1,
                },
            },
            { $group: { _id: `$${field}`, count: { $sum: 1 } } },
        ]);

        const groups = new Map<string, { key: string; label: string; count: number }>();
        let total = 0;
        let unknownCount = 0;
        for (const row of rows) {
            total += row.count;
            const category = normalizeDimension(query.dimension, row._id);
            if (category.key === UNKNOWN_CATEGORY.key) {
                unknownCount += row.count;
                continue;
            }
            const group = groups.get(category.key) ?? { ...category, count: 0 };
            group.count += row.count;
            groups.set(category.key, group);
        }

        const segments = [...groups.values()]
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
            .map((group) => ({ ...group, percentage: percentage(group.count, total) }));

        return this.envelope(
            {
                dimension: query.dimension,
                total,
                segments,
                unknownCount,
                unknownPercentage: percentage(unknownCount, total),
            },
            scope,
            { period: query.period, from: toIsoIst(window.from), to: toIsoIst(window.to) },
        );
    }

    // ---------------------------------------------------------------------------
    // 05 · GET /breakdown
    // ---------------------------------------------------------------------------

    async getBreakdown(auth: AuthContext, query: BreakdownQuery) {
        const scope = this.resolveScope(auth, query.agentId);
        const window = buildPeriodWindow(query);
        const stages = await this.getFirmStages(scope.firmIdStr);
        const field = DIMENSION_FIELDS[query.dimension];

        const rows = await this.aggregate<{ _id: { group?: unknown; stage?: unknown; status?: unknown }; count: number; revenue: number }>(Lead, [
            { $match: this.leadMatch(scope, { window, intent: query.intent, propertyType: query.propertyType }) },
            {
                $group: {
                    _id: { group: `$${field}`, stage: "$stage", status: "$status" },
                    count: { $sum: 1 },
                    revenue: { $sum: NUMERIC_REVENUE },
                },
            },
        ]);

        type BreakdownRow = {
            key: string;
            label: string;
            newLeads: number;
            activeLeads: number;
            dealsClosed: number;
            junkLeads: number;
            archivedLeads: number;
            unmappedLeads: number;
            totalLeads: number;
            revenueGenerated: number | null;
        };
        const newRow = (key: string, label: string): BreakdownRow => ({
            key,
            label,
            newLeads: 0,
            activeLeads: 0,
            dealsClosed: 0,
            junkLeads: 0,
            archivedLeads: 0,
            unmappedLeads: 0,
            totalLeads: 0,
            revenueGenerated: REALISED_REVENUE_ENABLED ? 0 : null,
        });
        const bucketColumn: Partial<Record<Bucket, keyof BreakdownRow>> = {
            new: "newLeads",
            active: "activeLeads",
            closed: "dealsClosed",
            junk: "junkLeads",
            archived: "archivedLeads",
            unmapped: "unmappedLeads",
        };

        const groups = new Map<string, BreakdownRow>();
        const totals = newRow("total", "Total");
        let otherStatusCount = 0;
        for (const row of rows) {
            const bucket = this.classify(stages, row._id.stage, row._id.status);
            if (bucket === "otherStatus") {
                otherStatusCount += row.count;
                continue;
            }
            const category = normalizeDimension(query.dimension, row._id.group);
            const target = groups.get(category.key) ?? newRow(category.key, category.label);
            for (const item of [target, totals]) {
                const column = bucketColumn[bucket]!;
                (item[column] as number) += row.count;
                item.totalLeads += row.count;
                if (bucket === "closed" && item.revenueGenerated !== null) item.revenueGenerated += row.revenue;
            }
            groups.set(category.key, target);
        }

        const page = sortAndPage([...groups.values()], query.sortBy, query.sortDir, "key", query.page, query.limit);

        return this.envelope(
            {
                dimension: query.dimension,
                rows: page.rows,
                totals,
                pagination: page.pagination,
                revenue: {
                    supported: REALISED_REVENUE_ENABLED,
                    basis: REALISED_REVENUE_ENABLED ? "closed_stage_estimate" : null,
                    reason: REALISED_REVENUE_ENABLED ? null : UNSUPPORTED_REASONS.realisedRevenue,
                },
            },
            scope,
            {
                period: query.period,
                from: toIsoIst(window.from),
                to: toIsoIst(window.to),
                currency: "INR",
                dataQuality: { unmappedStageCount: totals.unmappedLeads, otherStatusCount },
            },
        );
    }

    // ---------------------------------------------------------------------------
    // 06 · GET /pending-actions
    // ---------------------------------------------------------------------------

    async getPendingActions(auth: AuthContext, query: PendingActionsQuery) {
        const scope = this.resolveScope(auth, query.agentId);
        const items = query.entity === "leads" ? await this.pendingLeadActions(scope) : await this.pendingListingActions(scope);
        return this.envelope({ entity: query.entity, eligibleTotal: items.eligibleTotal, items: items.items }, scope);
    }

    /** Count of leads in a named stage, or in a named sub-stage of their current stage. */
    private namedStageFilter(stages: FirmStages, subStages: FirmSubStages, openIds: Types.ObjectId[], pattern: RegExp) {
        const openSet = new Set(openIds.map((id) => id.toHexString()));
        const stageIds = stages.list.filter((stage) => openSet.has(stage.id) && pattern.test(stage.name)).map((stage) => stage.id);
        const subs = [...subStages.byId.values()].filter((sub) => openSet.has(sub.stageId) && pattern.test(sub.name));
        if (stageIds.length === 0 && subs.length === 0) return null;
        const or: Record<string, unknown>[] = [];
        if (stageIds.length > 0) or.push({ stage: { $in: withIdForms(toObjectIds(stageIds)) } });
        for (const sub of subs) {
            or.push({
                stage: { $in: withIdForms(toObjectIds([sub.stageId])) },
                [`sub_stage.${sub.stageId}`]: { $regex: sub.id, $options: "i" },
            });
        }
        return { $or: or };
    }

    private async pendingLeadActions(scope: Scope): Promise<{ eligibleTotal: number; items: PendingItem[] }> {
        const [stages, subStages] = await Promise.all([
            this.getFirmStages(scope.firmIdStr),
            this.getFirmSubStages(scope.firmIdStr),
        ]);
        const openIds = this.openStageIds(stages);
        const eligible = { ...this.leadMatch(scope), status: 1, stage: { $in: withIdForms(openIds) } };

        const untouchedFilter = this.namedStageFilter(stages, subStages, openIds, UNTOUCHED_NAME);
        const unqualifiedFilter = this.namedStageFilter(stages, subStages, openIds, UNQUALIFIED_NAME);

        const visitContactsPromise =
            VISIT_COMPLETED_CODES.length === 0
                ? Promise.resolve(null)
                : this.aggregate<{ contacts: unknown[] }>(ScheduleVisit, [
                    { $match: { firm_id: scope.firmId, "status.code": { $in: VISIT_COMPLETED_CODES } } },
                    { $project: { contact: 1, latest: LATEST_STATUS } },
                    { $match: { "latest.code": { $in: VISIT_COMPLETED_CODES }, contact: { $ne: null } } },
                    { $group: { _id: null, contacts: { $addToSet: "$contact" } } },
                ]).then((rows) => toObjectIds(rows[0]?.contacts ?? []));

        const [eligibleTotal, untouched, unqualified, visitContacts, offerTenants, offerLeadIds] = await Promise.all([
            openIds.length === 0 ? 0 : this.countLeads(eligible),
            openIds.length === 0 || !untouchedFilter ? null : this.countLeads({ ...eligible, ...untouchedFilter }),
            openIds.length === 0 || !unqualifiedFilter ? null : this.countLeads({ ...eligible, ...unqualifiedFilter }),
            visitContactsPromise,
            Offer.distinct("tenant", { firm_id: scope.firmId }).maxTimeMS(QUERY_MAX_TIME_MS).exec(),
            Offer.distinct("lead_id", { firm_id: scope.firmId }).maxTimeMS(QUERY_MAX_TIME_MS).exec(),
        ]);

        const withVisits =
            visitContacts === null || eligibleTotal === 0
                ? null
                : await this.countLeads({ ...eligible, "contact_details.contact_id": { $in: visitContacts } });

        const tenants = toObjectIds(offerTenants);
        const leadIds = toObjectIds(offerLeadIds);
        const withOffers =
            eligibleTotal === 0 || (tenants.length === 0 && leadIds.length === 0)
                ? 0
                : await this.countLeads({
                    ...eligible,
                    $or: [{ "contact_details.contact_id": { $in: tenants } }, { _id: { $in: leadIds } }],
                });

        const items: PendingItem[] = [
            {
                key: "untouched",
                label: "Untouched Leads",
                count: untouchedFilter ? (untouched ?? 0) : null,
                supported: untouchedFilter !== null,
                reason: untouchedFilter ? null : UNSUPPORTED_REASONS.untouched,
                definition: "Open leads in the firm's 'Untouched' stage or sub-stage",
            },
            {
                key: "unqualified",
                label: "Unqualified Leads",
                count: unqualifiedFilter ? (unqualified ?? 0) : null,
                supported: unqualifiedFilter !== null,
                reason: unqualifiedFilter ? null : UNSUPPORTED_REASONS.unqualified,
                definition: "Open leads in the firm's 'Unqualified' stage or sub-stage",
            },
            {
                key: "noVisits",
                label: "Leads with no Visits",
                count: withVisits === null ? (visitContacts === null ? null : 0) : eligibleTotal - withVisits,
                supported: visitContacts !== null,
                reason: visitContacts === null ? UNSUPPORTED_REASONS.visits : null,
                definition: "Open leads whose contact has no completed visit in this firm",
            },
            {
                key: "noOffers",
                label: "Leads with no Offers",
                count: eligibleTotal - withOffers,
                supported: true,
                reason: null,
                definition: "Open leads with no offer in this firm (offer.tenant = lead contact, or offer.lead_id = lead)",
            },
        ];
        return { eligibleTotal, items };
    }

    private listingMatch(scope: Scope) {
        const match: Record<string, unknown> = {
            "broker_and_agent.firm_id": { $in: [scope.firmIdStr, scope.firmId] },
            "listing_details.listing_status": { $nin: INACTIVE_LISTING_STATUSES },
        };
        if (scope.agentIds) {
            match["broker_and_agent.broker_id"] = { $in: [...scope.agentIds.map((id) => id.toHexString()), ...scope.agentIds] };
        }
        return match;
    }

    private async pendingListingActions(scope: Scope): Promise<{ eligibleTotal: number; items: PendingItem[] }> {
        const match = this.listingMatch(scope);
        const imageCount = {
            $add: ["apartment", "ext_view_day", "ext_view_night", "amenities", "plans"].map((key) => ({
                $size: { $ifNull: [`$images.${key}`, []] },
            })),
        };
        const hasVideo = { $gt: [{ $strLenCP: { $trim: { input: { $ifNull: [{ $toString: "$video" }, ""] } } } }, 0] };

        const today = new Date();
        const visitedSince = istDateString(addDays(today, -LISTING_NO_VISIT_DAYS));
        const visitedUntil = istDateString(addDays(today, 1));

        const visitFilter = {
            listing_firm_id: scope.firmId,
            date: { $gte: visitedSince, $lt: visitedUntil },
        };

        const [mediaRows, visitedUnits] = await Promise.all([
            this.aggregate<{ total: number; noPhotos: number; noVideo: number }>(Listing, [
                { $match: match },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        noPhotos: { $sum: { $cond: [{ $eq: [imageCount, 0] }, 1, 0] } },
                        noVideo: { $sum: { $cond: [hasVideo, 0, 1] } },
                    },
                },
            ]),
            // Visit `date` is a "YYYY-MM-DD HH:mm:ss" string, so string ranges compare correctly.
            ScheduleVisit.distinct("project_unit_id", visitFilter)
                .maxTimeMS(QUERY_MAX_TIME_MS)
                .exec(),
        ]);
        const media = mediaRows[0] ?? { total: 0, noPhotos: 0, noVideo: 0 };
        const units = toObjectIds(visitedUnits);
        const withRecentVisits =
            media.total === 0 || units.length === 0
                ? 0
                : await Listing.countDocuments({
                    ...match,
                    $or: [{ _id: { $in: units } }, { "listing_details.unit_no": { $in: units } }],
                })
                    .maxTimeMS(QUERY_MAX_TIME_MS)
                    .exec();

        const items: PendingItem[] = [
            {
                key: "noPhotos",
                label: "Listings with no Photos",
                count: media.noPhotos,
                supported: true,
                reason: null,
                definition: "Live listings with no images in any image category",
            },
            {
                key: "noVideo",
                label: "Listings with no Video",
                count: media.noVideo,
                supported: true,
                reason: null,
                definition: "Live listings with an empty video field",
            },
            {
                key: "notShared14d",
                label: "Not Shared in 14 Days",
                count: null,
                supported: false,
                reason: UNSUPPORTED_REASONS.notShared,
                definition: "Live listings not shared in the last 14 days",
            },
            {
                key: "noVisits30d",
                label: "No Visits in 30 Days",
                count: media.total - withRecentVisits,
                supported: true,
                reason: null,
                definition: `Live listings with no scheduled visit dated in the last ${LISTING_NO_VISIT_DAYS} days (visit.project_unit_id = listing _id or unit_no)`,
            },
        ];
        return { eligibleTotal: media.total, items };
    }

    // ---------------------------------------------------------------------------
    // 07 · GET /ageing
    // ---------------------------------------------------------------------------

    async getAgeing(auth: AuthContext, query: AgeingQuery) {
        const scope = this.resolveScope(auth, query.agentId);
        const now = new Date();
        const cutoffs = AGEING_THRESHOLD_MONTHS.map((months) => ({ months, cutoff: addIstMonths(now, -months) }));

        let match: Record<string, unknown>;
        let dateExpr: unknown;
        let model: Model<any>;
        if (query.entity === "leads") {
            const stages = await this.getFirmStages(scope.firmIdStr);
            match = { ...this.leadMatch(scope), status: 1, stage: { $in: withIdForms(this.openStageIds(stages)) } };
            dateExpr = LEAD_DATE;
            model = Lead;
        } else {
            match = this.listingMatch(scope);
            dateExpr = "$createdAt";
            model = Listing;
        }

        const group: Record<string, unknown> = { _id: null, eligibleTotal: { $sum: 1 } };
        for (const { months, cutoff } of cutoffs) {
            group[`m${months}`] = { $sum: { $cond: [{ $lt: ["$d", cutoff] }, 1, 0] } };
        }
        const rows = await this.aggregate<Record<string, number>>(model, [
            { $match: match },
            { $project: { d: dateExpr } },
            { $group: group as PipelineStage.Group["$group"] },
        ]);
        const row = rows[0] ?? {};

        // Cumulative "older than N months": counts are non-increasing as N grows.
        return this.envelope(
            {
                entity: query.entity,
                eligibleTotal: row.eligibleTotal ?? 0,
                thresholds: cutoffs.map(({ months, cutoff }) => ({
                    months,
                    olderThan: toIsoIst(cutoff),
                    count: row[`m${months}`] ?? 0,
                })),
            },
            scope,
        );
    }

    // ---------------------------------------------------------------------------
    // 08 · GET /performance
    // ---------------------------------------------------------------------------

    async getPerformance(auth: AuthContext, query: PerformanceQuery) {
        const scope = this.resolveScope(auth, query.agentId);
        const window = buildPeriodWindow(query);
        const [stages, roster, visits] = await Promise.all([
            this.getFirmStages(scope.firmIdStr),
            this.getRoster(scope, auth),
            this.completedVisitsByAgent(scope, window),
        ]);

        const rows = await this.aggregate<{ _id: { agent?: unknown; stage?: unknown; status?: unknown }; count: number; revenue: number }>(Lead, [
            { $match: this.leadMatch(scope, { window, intent: query.intent, propertyType: query.propertyType }) },
            {
                $group: {
                    _id: { agent: "$assign_to", stage: "$stage", status: "$status" },
                    count: { $sum: 1 },
                    revenue: { $sum: NUMERIC_REVENUE },
                },
            },
        ]);

        type AgentTotals = { totalLeads: number; archivedLeads: number; dealsClosed: number; revenue: number };
        const byAgent = new Map<string, AgentTotals>();
        for (const row of rows) {
            const agentId = String(row._id.agent ?? "").toLowerCase();
            const totals = byAgent.get(agentId) ?? { totalLeads: 0, archivedLeads: 0, dealsClosed: 0, revenue: 0 };
            const bucket = this.classify(stages, row._id.stage, row._id.status);
            if (bucket === "archived") totals.archivedLeads += row.count;
            else if (bucket !== "otherStatus") totals.totalLeads += row.count;
            if (bucket === "closed") {
                totals.dealsClosed += row.count;
                totals.revenue += row.revenue;
            }
            byAgent.set(agentId, totals);
        }

        const agentRows = roster.map((agent) => {
            const totals = byAgent.get(agent.agentId);
            return {
                agentId: agent.agentId,
                totalLeads: totals?.totalLeads ?? 0,
                archivedLeads: totals?.archivedLeads ?? 0,
                visitsDone: visits ? (visits.get(agent.agentId) ?? 0) : null,
                dealsClosed: totals?.dealsClosed ?? 0,
                revenueGenerated: REALISED_REVENUE_ENABLED ? (totals?.revenue ?? 0) : null,
            };
        });

        const page = sortAndPage(agentRows, query.sortBy, query.sortDir, "agentId", query.page, query.limit);

        return this.envelope(
            {
                rows: page.rows,
                pagination: page.pagination,
                supported: {
                    totalLeads: true,
                    visitsDone: visits !== null,
                    dealsClosed: true,
                    revenueGenerated: REALISED_REVENUE_ENABLED,
                },
                reasons: {
                    visitsDone: visits === null ? UNSUPPORTED_REASONS.visits : null,
                    revenueGenerated: REALISED_REVENUE_ENABLED ? null : UNSUPPORTED_REASONS.realisedRevenue,
                },
            },
            scope,
            { period: query.period, from: toIsoIst(window.from), to: toIsoIst(window.to), currency: "INR" },
        );
    }

    // ---------------------------------------------------------------------------
    // 09 · GET /forecast
    // ---------------------------------------------------------------------------

    async getForecast(auth: AuthContext, query: ForecastQuery) {
        const scope = this.resolveScope(auth, query.agentId);
        const [stages, roster] = await Promise.all([this.getFirmStages(scope.firmIdStr), this.getRoster(scope, auth)]);
        const openIds = this.openStageIds(stages);

        const today = istDayStart(new Date());
        const horizons = FORECAST_HORIZON_MONTHS.map((months) => ({ months, until: addIstMonths(today, months) }));
        const valid = { $and: [{ $eq: [{ $type: CLOSURE_DATE }, "date"] }, { $isNumber: ESTIMATED_REVENUE }] };

        const group: Record<string, unknown> = {
            _id: "$assign_to",
            activeLeads: { $sum: 1 },
            missingEstimateCount: { $sum: { $cond: [valid, 0, 1] } },
            overdueEstimateCount: { $sum: { $cond: [{ $and: [valid, { $lt: [CLOSURE_DATE, today] }] }, 1, 0] } },
        };
        for (const { months, until } of horizons) {
            group[`revenueWithin${months}m`] = {
                $sum: {
                    $cond: [{ $and: [valid, { $gte: [CLOSURE_DATE, today] }, { $lt: [CLOSURE_DATE, until] }] }, ESTIMATED_REVENUE, 0],
                },
            };
        }

        const rows = openIds.length === 0 ? [] : await this.aggregate<Record<string, unknown> & { _id: unknown }>(Lead, [
            {
                $match: {
                    ...this.leadMatch(scope, { intent: query.intent, propertyType: query.propertyType }),
                    status: 1,
                    stage: { $in: withIdForms(openIds) },
                },
            },
            { $group: group as PipelineStage.Group["$group"] },
        ]);
        const byAgent = new Map(rows.map((row) => [String(row._id ?? "").toLowerCase(), row]));

        const metricKeys = ["activeLeads", "revenueWithin1m", "revenueWithin3m", "revenueWithin6m", "missingEstimateCount", "overdueEstimateCount"] as const;
        const totals = Object.fromEntries(metricKeys.map((key) => [key, 0])) as Record<(typeof metricKeys)[number], number>;
        const agentRows = roster.map((agent) => {
            const row = byAgent.get(agent.agentId);
            const values = Object.fromEntries(metricKeys.map((key) => [key, Number(row?.[key] ?? 0)])) as Record<(typeof metricKeys)[number], number>;
            for (const key of metricKeys) totals[key] += values[key];
            return { agentId: agent.agentId, ...values };
        });

        const page = sortAndPage(agentRows, query.sortBy, query.sortDir, "agentId", query.page, query.limit);

        return this.envelope(
            {
                rows: page.rows,
                totals,
                pagination: page.pagination,
                horizons: horizons.map(({ months, until }) => ({ months, from: toIsoIst(today), to: toIsoIst(until) })),
            },
            scope,
            { currency: "INR" },
        );
    }
}

const dashboardService = new DashboardService();
export default dashboardService;
