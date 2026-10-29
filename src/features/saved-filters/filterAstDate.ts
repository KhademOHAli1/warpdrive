import { type SQL, sql } from "drizzle-orm";
import { isCalendarDate, isDatePreset } from "@/constants/dateFilterPresets";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { type DateFilterContext, resolveDatePresetRange, resolveTimeZone } from "./datePresetRange";

export { resolveTimeZone } from "./datePresetRange";

import { requireValue } from "./filterAstSql";

type DateColumnKind = "date" | "timestamptz";

const DATE_COLUMN_KIND: Record<string, DateColumnKind> = {
  expectedCloseDate: "date",
  nextActivityAt: "timestamptz",
  lastActivityAt: "timestamptz",
};

interface DayRange {
  start: SQL;
  end: SQL;
}

function localDayRange(
  op: string,
  raw: string | number | string[],
  zone: string,
  context: DateFilterContext,
): DayRange {
  if (Array.isArray(raw)) {
    throw new AppError(ERROR_IDS.DEAL_FILTER_INVALID, "List value on a date field", { op });
  }
  const value = String(raw);
  if (isDatePreset(value)) {
    const range = resolveDatePresetRange(value, { ...context, timeZone: zone });
    return { start: sql`${range.startDate}::date`, end: sql`${range.endDateExclusive}::date` };
  }
  if (!isCalendarDate(value)) {
    throw new AppError(ERROR_IDS.DEAL_FILTER_INVALID, "Date field needs a date or a preset", {
      op,
    });
  }
  return { start: sql`${value}::date`, end: sql`${value}::date + 1` };
}

function asInstant(day: SQL, zone: string): SQL {
  return sql`((${day})::timestamp AT TIME ZONE ${zone})`;
}

function columnRange(
  field: string,
  op: string,
  raw: string | number | string[],
  zone: string,
  context: DateFilterContext,
) {
  const kind = DATE_COLUMN_KIND[field];
  if (kind === undefined) {
    throw new AppError(ERROR_IDS.DEAL_FILTER_INVALID, "Not a date filter field", { field });
  }
  const local = localDayRange(op, raw, zone, context);
  if (kind === "date") return local;
  return { start: asInstant(local.start, zone), end: asInstant(local.end, zone) };
}

export function dateCondition(
  colSql: SQL,
  field: string,
  op: string,
  value: string | number | string[] | undefined,
  timeZone: string | null | undefined,
  context: DateFilterContext = {},
): SQL {
  const zone = resolveTimeZone(timeZone);
  const { start, end } = columnRange(field, op, requireValue(op, value), zone, context);
  switch (op) {
    case "eq":
      return sql`(${colSql} >= ${start} AND ${colSql} < ${end})`;
    case "neq":
      return sql`(${colSql} IS NULL OR ${colSql} < ${start} OR ${colSql} >= ${end})`;
    case "gt":
      return sql`${colSql} >= ${end}`;
    case "gte":
      return sql`${colSql} >= ${start}`;
    case "lt":
      return sql`${colSql} < ${start}`;
    case "lte":
      return sql`${colSql} < ${end}`;
    default:
      throw new AppError(ERROR_IDS.DEAL_FILTER_INVALID, "Unsupported operator on a date field", {
        op,
      });
  }
}
