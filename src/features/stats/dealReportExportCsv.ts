import { z } from "zod";
import { canonicalMoney } from "@/lib/canonicalMoney";
import {
  DEAL_REPORT_EXPORT_LIMIT,
  type DealReportExportScope,
  exportTimeZone,
} from "./dealReportExportRequest";
import {
  ANALYTICS_METRIC_DICTIONARY_VERSION,
  DEAL_RECORD_METRIC_DICTIONARY,
  DEAL_RECORD_METRICS,
} from "./metricDictionary";
import { toToken } from "./ownerScopeToken";
import { ownerScopeInput, wonMonthInput } from "./schemas";

const MAX_CSV_BYTES = 16_384;
const HEADER = "deal_id,status,currency,value,created_at_utc,closed_at_utc";
const currency = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/);
const utc = z.iso.datetime({ precision: 6 }).refine((value) => value.endsWith("Z"));
const canonicalAmount = (value: string) =>
  value === value.trim() && canonicalMoney(value) === value;
const rowSchema = z.object({
  id: z
    .string()
    .length(36)
    .regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/),
  status: z.enum(["open", "won", "lost"]),
  currency,
  value: z
    .string()
    .regex(/^-?(?:0|[1-9][0-9]{0,13})\.[0-9]{2,4}$/)
    .refine(canonicalAmount)
    .nullable(),
  createdAt: utc,
  closedAt: utc.nullable(),
});
const reportSchema = z.object({
  metric: z.enum(DEAL_RECORD_METRICS),
  wonMonth: wonMonthInput,
  definitionVersion: z.literal(ANALYTICS_METRIC_DICTIONARY_VERSION),
  currency,
  effectiveOwnerScope: ownerScopeInput,
  timeZone: exportTimeZone,
  rows: z.custom<readonly unknown[]>(Array.isArray),
  nextCursor: z.strictObject({ createdAt: utc, id: rowSchema.shape.id }).nullable(),
  totals: z.strictObject({
    count: z.number().int().nonnegative(),
    valueCount: z.number().int().nonnegative(),
    value: z
      .string()
      .regex(/^-?(?:0|[1-9][0-9]{0,20})\.[0-9]{2,4}$/)
      .refine(canonicalAmount),
  }),
});

type CsvResult = { state: "ready"; csv: string } | { state: "too-large" } | { state: "invalid" };

function exactUnits(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const units = BigInt(`${whole}${fraction.padEnd(4, "0")}`);
  return negative ? -units : units;
}

function readExportRow(input: unknown, scope: Pick<DealReportExportScope, "currency" | "metric">) {
  const parsed = rowSchema.safeParse(input);
  if (!parsed.success || parsed.data.currency !== scope.currency) return null;
  const row = parsed.data;
  const definition = DEAL_RECORD_METRIC_DICTIONARY[scope.metric];
  const statuses: readonly string[] = definition.currentStatus;
  if (!statuses.includes(row.status)) return null;
  if (definition.basis === "current-close-date" && row.closedAt === null) return null;
  if (definition.valueRequired && row.value === null) return null;
  if (
    definition.nonnegativeWonCycleRequired &&
    (row.closedAt === null || row.closedAt < row.createdAt)
  )
    return null;
  return row;
}

/** Only typed ASCII fields enter the CSV. A signed decimal is a numeric literal. */
export function serializeDealReportExport(
  input: unknown,
  expected: Pick<
    DealReportExportScope,
    "currency" | "ownerScope" | "metric" | "timeZone" | "wonMonth"
  >,
): CsvResult {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { state: "invalid" };
  const report = parsed.data;
  if (
    report.currency !== expected.currency ||
    report.metric !== expected.metric ||
    report.wonMonth !== expected.wonMonth ||
    report.timeZone !== expected.timeZone ||
    toToken(report.effectiveOwnerScope) !== toToken(expected.ownerScope)
  )
    return { state: "invalid" };
  if (Math.max(report.totals.count, report.rows.length) > DEAL_REPORT_EXPORT_LIMIT)
    return { state: "too-large" };
  if (report.nextCursor !== null || report.totals.count !== report.rows.length)
    return { state: "invalid" };

  const lines = [HEADER];
  const seen = new Set<string>();
  let valueCount = 0;
  let value = 0n;
  for (const inputRow of report.rows) {
    const row = readExportRow(inputRow, expected);
    if (row === null || seen.has(row.id)) return { state: "invalid" };
    seen.add(row.id);
    if (row.value !== null) {
      valueCount += 1;
      value += exactUnits(row.value);
    }
    lines.push(
      [row.id, row.status, row.currency, row.value ?? "", row.createdAt, row.closedAt ?? ""].join(
        ",",
      ),
    );
  }
  if (valueCount !== report.totals.valueCount || value !== exactUnits(report.totals.value))
    return { state: "invalid" };
  const csv = `${lines.join("\r\n")}\r\n`;
  return new TextEncoder().encode(csv).length <= MAX_CSV_BYTES
    ? { state: "ready", csv }
    : { state: "too-large" };
}
