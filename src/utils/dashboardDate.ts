import { MAX_CUSTOM_MONTHS, PERIOD_MONTHS } from "../constants/dashboard.constant.js";
import type { Period } from "../constants/dashboard.constant.js";
import { ApiError } from "./apiError.js";

// Asia/Kolkata has a fixed +05:30 offset and no DST, so month/day boundaries can be
// computed arithmetically and handed to MongoDB as UTC instants.
export const IST_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Half-open [from, to) window plus the zero-filled month keys it covers. */
export type DateWindow = { from: Date; to: Date; months: string[] };

const shifted = (date: Date) => new Date(date.getTime() + IST_OFFSET_MS);

export const istMonthStart = (year: number, month: number) => new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS);

export const istDayStart = (date: Date) => {
    const s = shifted(date);
    return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - IST_OFFSET_MS);
};

export const monthKey = (year: number, month: number) => {
    const d = new Date(Date.UTC(year, month, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** Same IST wall-clock time n calendar months away, clamped to the month's last day. */
export const addIstMonths = (date: Date, n: number) => {
    const s = shifted(date);
    const year = s.getUTCFullYear();
    const month = s.getUTCMonth() + n;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(s.getUTCDate(), lastDay);
    const utc = Date.UTC(year, month, day, s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds(), s.getUTCMilliseconds());
    return new Date(utc - IST_OFFSET_MS);
};

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/** "YYYY-MM-DD" of the IST calendar day. */
export const istDateString = (date: Date) => shifted(date).toISOString().slice(0, 10);

export const toIsoIst = (date: Date) => `${shifted(date).toISOString().slice(0, 19)}+05:30`;

const monthsBetween = (fromYear: number, fromMonth: number, count: number) =>
    Array.from({ length: count }, (_, i) => monthKey(fromYear, fromMonth + i));

const parseDay = (value: string) => {
    const [year, month, day] = value.split("-").map(Number) as [number, number, number];
    return { year, month: month - 1, day };
};

/**
 * "6m" = current IST calendar month + 5 prior months, [first-day, next-month-start).
 * "custom" = whole IST days from..to inclusive, up to MAX_CUSTOM_MONTHS months.
 */
export const buildPeriodWindow = (
    query: { period: Period; from?: string | undefined; to?: string | undefined },
    now = new Date(),
): DateWindow => {
    if (query.period === "custom") {
        if (!query.from || !query.to) {
            throw new ApiError(400, "Custom period requires from and to");
        }
        const from = parseDay(query.from);
        const to = parseDay(query.to);
        const count = (to.year - from.year) * 12 + (to.month - from.month) + 1;
        return {
            from: new Date(Date.UTC(from.year, from.month, from.day) - IST_OFFSET_MS),
            to: new Date(Date.UTC(to.year, to.month, to.day + 1) - IST_OFFSET_MS),
            months: monthsBetween(from.year, from.month, count),
        };
    }

    const months = PERIOD_MONTHS[query.period];
    const s = shifted(now);
    const year = s.getUTCFullYear();
    const month = s.getUTCMonth();
    return {
        from: istMonthStart(year, month - (months - 1)),
        to: istMonthStart(year, month + 1),
        months: monthsBetween(year, month - (months - 1), months),
    };
};

/** Number of calendar months a YYYY-MM-DD range touches; used by validation. */
export const customRangeMonths = (from: string, to: string) => {
    const a = parseDay(from);
    const b = parseDay(to);
    return (b.year - a.year) * 12 + (b.month - a.month) + 1;
};

export { MAX_CUSTOM_MONTHS };
