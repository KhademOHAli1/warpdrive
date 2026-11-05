import type {
  KpiAssessment,
  KpiCondition,
  KpiDefinitionInput,
  KpiMeasurement,
  KpiPeriod,
  KpiStatus,
} from "./kpiModel";

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const date = (d: string) => new Date(`${d}T00:00:00Z`);
export function kpiPeriodBounds(
  period: KpiPeriod,
  on: string,
): { start: string; end: string } | null {
  const endsOn = period.endsOn;
  if (on < period.startsOn || (endsOn !== undefined && endsOn !== null && on > endsOn)) return null;
  if (period.kind === "one_off")
    return { start: period.startsOn, end: period.endsOn ?? period.startsOn };
  if (period.kind === "rolling")
    return {
      start: iso(
        new Date(
          Math.max(
            date(period.startsOn).getTime(),
            date(on).getTime() - ((period.rollingDays ?? 30) - 1) * DAY,
          ),
        ),
      ),
      end: on,
    };
  const d = date(on);
  let start: Date;
  let end: Date;
  if (period.interval === "weekly") {
    start = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY);
    end = new Date(start.getTime() + 6 * DAY);
  } else {
    const step = period.interval === "monthly" ? 1 : period.interval === "quarterly" ? 3 : 12;
    const fiscal = (period.fiscalStartMonth ?? 1) - 1;
    const absolute = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const anchor = absolute - ((((absolute - fiscal) % step) + step) % step);
    start = new Date(Date.UTC(Math.floor(anchor / 12), anchor % 12, 1));
    end = new Date(Date.UTC(Math.floor((anchor + step) / 12), (anchor + step) % 12, 0));
  }
  return {
    // biome-ignore lint/complexity/useMathMinMax: ISO dates compare lexically, not numerically.
    start: iso(start) < period.startsOn ? period.startsOn : iso(start),
    end: endsOn !== undefined && endsOn !== null && endsOn < iso(end) ? endsOn : iso(end),
  };
}

export interface KpiRecord {
  id: string;
  label: string;
  href: string | null;
  value: string | null;
  statuses: KpiStatus[];
  currency?: string;
  sampleSize?: number | null;
  measuredOn?: string;
  observedOn?: string;
  missingMeasurementDate?: boolean;
}
function matches(record: KpiRecord, status: KpiStatus | undefined) {
  return status === undefined || status === "all" || record.statuses.includes(status);
}
const SCALE = 10000n;
function scaled(value: string): bigint | null {
  if (!/^-?\d+(\.\d{1,4})?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = value.replace(/^-/u, "").split(".");
  const amount = BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, "0"));
  return negative ? -amount : amount;
}
export function compareKpiDecimals(left: string, right: string): number | null {
  const a = scaled(left);
  const b = scaled(right);
  if (a === null || b === null) return null;
  return a < b ? -1 : a > b ? 1 : 0;
}
function decimal(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const v = value < 0n ? -value : value;
  const fraction = (v % SCALE).toString().padStart(4, "0").replace(/0+$/u, "");
  return `${sign}${v / SCALE}${fraction ? `.${fraction}` : ""}`;
}
export function unavailableKpi(issue: string, period: KpiMeasurement["period"]): KpiMeasurement {
  return {
    state: "unavailable",
    value: null,
    recordCount: 0,
    excludedCount: 0,
    numerator: null,
    denominator: null,
    sampleSize: null,
    contributors: [],
    contributorsTruncated: false,
    issues: ["viewer_visible_records", issue],
    evaluatedAt: new Date().toISOString(),
    period,
  };
}
type SelectedRecord = { record: KpiRecord; reason: string | null };
function countsRecords(definition: KpiDefinitionInput): boolean {
  return ["count", "distinct_count", "percentage", "ratio"].includes(definition.calculation);
}
function selectionReason(definition: KpiDefinitionInput, record: KpiRecord): string | null {
  if (!matches(record, definition.filters.status)) return "outside_status_filter";
  if (
    definition.unit === "money" &&
    definition.source !== "manual" &&
    record.currency !== definition.currency
  )
    return "different_currency";
  if (definition.calculation === "percentage" && !matches(record, definition.denominatorStatus))
    return "outside_denominator";
  if (
    definition.calculation === "ratio" &&
    !matches(record, definition.numeratorStatus) &&
    !matches(record, definition.denominatorStatus)
  )
    return "outside_ratio_population";
  if (record.missingMeasurementDate === true) return "missing_measurement_date";
  if (countsRecords(definition)) return null;
  const value = scaled(record.value ?? "");
  if (value === null) return "missing_value";
  const duration = definition.valueField === "sales_cycle" || definition.valueField === "duration";
  return duration && value < 0n ? "invalid_duration" : null;
}
function numericAggregate(
  definition: KpiDefinitionInput,
  records: KpiRecord[],
  missing: number,
): string | null {
  const values = records
    .map((r) => scaled(r.value ?? ""))
    .filter((v): v is bigint => v !== null)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (values.length === 0) return definition.calculation === "sum" && missing === 0 ? "0" : null;
  if (definition.calculation === "median") {
    const middle = Math.floor(values.length / 2);
    const center = values[middle] ?? 0n;
    return decimal(values.length % 2 === 1 ? center : ((values[middle - 1] ?? 0n) + center) / 2n);
  }
  const total = values.reduce((sum, value) => sum + value, 0n);
  return decimal(definition.calculation === "sum" ? total : total / BigInt(values.length));
}
function aggregateRecords(definition: KpiDefinitionInput, records: KpiRecord[], missing: number) {
  if (definition.calculation === "percentage" || definition.calculation === "ratio") {
    const numerator = records.filter((r) => matches(r, definition.numeratorStatus)).length;
    const denominator = records.filter((r) => matches(r, definition.denominatorStatus)).length;
    const multiplier = definition.calculation === "percentage" ? 100n : 1n;
    const value =
      denominator === 0
        ? null
        : decimal((BigInt(numerator) * SCALE * multiplier) / BigInt(denominator));
    return { value, numerator, denominator };
  }
  let value: string | null;
  if (definition.calculation === "count") value = String(records.length);
  else if (definition.calculation === "distinct_count")
    value = String(new Set(records.map((r) => r.id)).size);
  else value = numericAggregate(definition, records, missing);
  return { value, numerator: null, denominator: null };
}
function measurementMetadata(
  definition: KpiDefinitionInput,
  included: KpiRecord[],
  value: string | null,
  missing: number,
  truncated: boolean,
  on: string,
  denominator: number | null,
  missingDates: number,
) {
  const issues = ["viewer_visible_records"];
  if (denominator === 0) issues.push("zero_denominator");
  if (missing > missingDates) issues.push("missing_values");
  if (missingDates > 0) issues.push("missing_measurement_dates");
  if (truncated) issues.push("record_limit");
  let state: KpiMeasurement["state"] = "available";
  if (value === null) state = "unavailable";
  else if (missing > 0 || truncated) state = "incomplete";
  if (definition.source !== "manual") return { state, issues };
  issues.push("manual_observations");
  if (definition.calculation === "average") issues.push("unweighted_observation_average");
  const latest = included
    .map((r) => r.measuredOn ?? "")
    .sort()
    .at(-1);
  if (
    latest !== undefined &&
    latest !== "" &&
    state === "available" &&
    date(on).getTime() - date(latest).getTime() > 7 * DAY
  ) {
    state = "stale";
    issues.push("measurement_older_than_seven_days");
  }
  return { state, issues };
}
function contributor(definition: KpiDefinitionInput, { record, reason }: SelectedRecord) {
  const ratio = definition.calculation === "percentage" || definition.calculation === "ratio";
  const value = reason !== null ? null : countsRecords(definition) ? "1" : record.value;
  return {
    id: record.id,
    label: record.label,
    href: record.href,
    observedOn: record.observedOn ?? record.measuredOn ?? null,
    statuses: record.statuses,
    value,
    included: reason === null,
    reason,
    ...(ratio
      ? {
          numeratorMember: reason === null && matches(record, definition.numeratorStatus),
          denominatorMember: reason === null && matches(record, definition.denominatorStatus),
        }
      : {}),
  };
}
/** Uses exact four-place decimal arithmetic for source money, with explicit exclusions. */
export function evaluateKpiRecords(
  definition: KpiDefinitionInput,
  records: KpiRecord[],
  period: NonNullable<KpiMeasurement["period"]>,
  options: { truncated?: boolean; on: string },
): KpiMeasurement {
  if (definition.source === "manual" && records.length === 0)
    return unavailableKpi("no_manual_measurements", period);
  const selected = records.map((record) => ({
    record,
    reason: selectionReason(definition, record),
  }));
  const included = selected.filter((row) => row.reason === null).map((row) => row.record);
  const missing = selected.filter(
    (row) =>
      row.reason === "missing_value" ||
      row.reason === "invalid_duration" ||
      row.reason === "missing_measurement_date",
  ).length;
  const missingDates = selected.filter((row) => row.reason === "missing_measurement_date").length;
  const aggregate = aggregateRecords(definition, included, missing);
  const metadata = measurementMetadata(
    definition,
    included,
    aggregate.value,
    missing,
    options.truncated === true,
    options.on,
    aggregate.denominator,
    missingDates,
  );
  const manualSamples = included.reduce((sum, record) => sum + (record.sampleSize ?? 0), 0);
  return {
    ...metadata,
    ...aggregate,
    recordCount: included.length,
    excludedCount: selected.length - included.length,
    missingMeasurementDateCount: missingDates,
    sampleSize: definition.source === "manual" ? manualSamples || null : included.length,
    contributors: selected.slice(0, 100).map((row) => contributor(definition, row)),
    contributorsTruncated: records.length > 100 || options.truncated === true,
    evaluatedAt: new Date().toISOString(),
    period,
  };
}

type ConditionScore = { met: boolean; attained: number };
function minimumScore(actual: bigint, target: bigint): ConditionScore {
  const met = actual >= target;
  const attained = target > 0n ? Math.max(0, Number(actual) / Number(target)) : met ? 1 : 0;
  return { met, attained };
}
function maximumScore(actual: bigint, target: bigint): ConditionScore {
  const met = actual <= target;
  const attained = met ? 1 : actual > 0n && target >= 0n ? Number(target) / Number(actual) : 0;
  return { met, attained };
}
function rangeScore(
  condition: KpiCondition,
  actual: bigint,
  target: bigint,
): ConditionScore | null {
  const upper = scaled(condition.upperTarget ?? "");
  if (upper === null) return null;
  const met = actual >= target && actual <= upper;
  return { met, attained: met ? 1 : 0 };
}
function improvementScore(
  condition: KpiCondition,
  actual: bigint,
  target: bigint,
): ConditionScore | null {
  const baseline = scaled(condition.baseline ?? "");
  if (baseline === null) return null;
  const change = (actual - baseline) * (condition.direction === "decrease" ? -1n : 1n);
  return minimumScore(change, target);
}
function conditionScore(
  condition: KpiCondition,
  actual: bigint,
  target: bigint,
): ConditionScore | null {
  switch (condition.kind) {
    case "at_most":
      return maximumScore(actual, target);
    case "range":
      return rangeScore(condition, actual, target);
    case "improve":
      return improvementScore(condition, actual, target);
    case "at_least":
    case "deadline":
      return minimumScore(actual, target);
  }
}
function elapsedShare(period: NonNullable<KpiMeasurement["period"]>, on: string): number {
  const total = date(period.end).getTime() - date(period.start).getTime() + DAY;
  return Math.max(
    0,
    Math.min(1, (date(on).getTime() - date(period.start).getTime() + DAY) / total),
  );
}
export function assessKpi(
  condition: KpiCondition,
  measurement: KpiMeasurement,
  pacing: "linear" | "none",
  on: string,
): KpiAssessment {
  const unavailable: KpiAssessment = { standing: "unavailable", attainment: null, pace: null };
  if (
    measurement.state !== "available" ||
    measurement.value === null ||
    measurement.period === null
  )
    return unavailable;
  const actual = scaled(measurement.value);
  const target = scaled(condition.target);
  if (actual === null || target === null) return unavailable;
  const score = conditionScore(condition, actual, target);
  if (score === null) return unavailable;
  const beforeDeadline = condition.kind === "deadline" && on < measurement.period.end;
  const elapsed = elapsedShare(measurement.period, on);
  return {
    standing: beforeDeadline && !score.met ? "in_progress" : score.met ? "met" : "not_met",
    attainment: score.attained,
    pace: pacing === "linear" && elapsed > 0 ? score.attained / elapsed : null,
  };
}
