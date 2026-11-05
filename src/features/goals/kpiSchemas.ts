import { z } from "zod";
import { compareKpiDecimals } from "./kpiEngine";
import { KPI_CALCULATIONS, KPI_SOURCES, KPI_STATUSES, KPI_UNITS } from "./kpiModel";

const decimal = z.string().regex(/^-?\d{1,14}(\.\d{1,4})?$/);
const status = z.enum(KPI_STATUSES);
const definitionShape = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1200).default(""),
  source: z.enum(KPI_SOURCES),
  calculation: z.enum(KPI_CALCULATIONS),
  unit: z.enum(KPI_UNITS),
  customUnit: z.string().trim().max(32).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  dateField: z.enum(["created", "closed", "completed", "due", "measured"]),
  filters: z
    .object({
      pipelineId: z.string().uuid().nullable().optional(),
      activityTypeId: z.string().uuid().nullable().optional(),
      status: status.optional(),
    })
    .default({}),
  numeratorStatus: status.optional(),
  denominatorStatus: status.optional(),
  valueField: z.enum(["value", "sales_cycle", "duration"]).optional(),
});
type Definition = z.infer<typeof definitionShape>;
type DefinitionIssue = (message: string, path: string) => void;
function hasReference(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value !== "";
}
function validateManual(d: Definition, issue: DefinitionIssue): void {
  if (d.dateField !== "measured")
    issue("Manual observations use their measurement date", "dateField");
  if (!["sum", "average", "median"].includes(d.calculation))
    issue("Manual observations support sum, average and median", "calculation");
  if (
    hasReference(d.filters.pipelineId) ||
    hasReference(d.filters.activityTypeId) ||
    (d.filters.status !== undefined && d.filters.status !== "all")
  )
    issue("Manual observations are scoped by their assignment", "filters");
}
function validateSource(d: Definition, issue: DefinitionIssue): void {
  const statuses =
    d.source === "deals"
      ? ["all", "won", "lost", "open", "closed"]
      : ["all", "open", "completed", "overdue"];
  for (const field of ["numeratorStatus", "denominatorStatus"] as const) {
    const selected = d[field];
    if (selected !== undefined && !statuses.includes(selected))
      issue("This status is unavailable for the source", field);
  }
  if (d.filters.status !== undefined && !statuses.includes(d.filters.status))
    issue("This status is unavailable for the source", "filters");
  if (d.source === "deals" && !["created", "closed"].includes(d.dateField))
    issue("Deals use creation or closure date", "dateField");
  if (d.source === "activities" && !["created", "completed", "due"].includes(d.dateField))
    issue("Activities use creation, completion or due date", "dateField");
  if (d.source === "deals" && hasReference(d.filters.activityTypeId))
    issue("Deals have no activity type", "filters");
}
function validateRatio(d: Definition, issue: DefinitionIssue): void {
  if (d.numeratorStatus === undefined || d.denominatorStatus === undefined)
    issue("Choose both numerator and denominator", "numeratorStatus");
  if (d.filters.status !== undefined && d.filters.status !== "all")
    issue("Ratio filters must allow the full denominator", "filters");
  if (d.calculation === "percentage" && d.unit !== "percent")
    issue("Percentages use percent units", "unit");
  if (d.calculation === "ratio" && d.unit !== "custom")
    issue("Ratios use a named custom unit", "unit");
}
function validateDuration(d: Definition, issue: DefinitionIssue): void {
  if (!["hours", "days"].includes(d.unit)) issue("Durations use hours or days", "unit");
  if (d.source === "deals" && d.valueField !== "sales_cycle")
    issue("Choose the sales-cycle field", "valueField");
  if (d.source === "activities" && d.valueField !== "duration")
    issue("Choose recorded activity duration", "valueField");
  if (d.calculation === "duration" && d.source === "deals" && d.dateField !== "closed")
    issue("Sales-cycle duration uses the closure date", "dateField");
}
function validateAggregate(d: Definition, issue: DefinitionIssue): void {
  if (["percentage", "ratio"].includes(d.calculation)) {
    validateRatio(d, issue);
    return;
  }
  if (["count", "distinct_count"].includes(d.calculation)) {
    if (d.unit !== "count") issue("Counts use quantity units", "unit");
    return;
  }
  if (
    d.calculation === "duration" ||
    d.valueField === "sales_cycle" ||
    d.valueField === "duration"
  ) {
    validateDuration(d, issue);
    return;
  }
  if (d.source !== "deals" || d.valueField !== "value" || d.unit !== "money")
    issue("Numeric CRM aggregates require deal value or a duration field", "valueField");
}
export const kpiDefinitionInput = definitionShape.superRefine((d, ctx) => {
  const issue: DefinitionIssue = (message, path) =>
    ctx.addIssue({ code: "custom", message, path: [path] });
  if (d.unit === "money" && (d.currency === undefined || d.currency === ""))
    issue("A money KPI needs a currency", "currency");
  if (d.unit === "custom" && (d.customUnit === undefined || d.customUnit === ""))
    issue("Name the custom unit", "customUnit");
  if (d.source === "manual") {
    validateManual(d, issue);
    return;
  }
  validateSource(d, issue);
  validateAggregate(d, issue);
});
export const kpiConditionInput = z
  .object({
    kind: z.enum(["at_least", "at_most", "range", "improve", "deadline"]),
    target: decimal,
    upperTarget: decimal.optional(),
    baseline: decimal.optional(),
    direction: z.enum(["increase", "decrease"]).optional(),
  })
  .superRefine((c, ctx) => {
    if (
      c.kind === "range" &&
      (c.upperTarget === undefined || compareKpiDecimals(c.upperTarget, c.target) === -1)
    )
      ctx.addIssue({
        code: "custom",
        message: "A range needs an upper target at least equal to its lower target",
        path: ["upperTarget"],
      });
    if (
      c.kind === "improve" &&
      (c.baseline === undefined || c.direction === undefined || Number(c.target) < 0)
    )
      ctx.addIssue({
        code: "custom",
        message: "Improvement needs a baseline, direction and nonnegative absolute change",
        path: ["baseline"],
      });
  });
export const kpiPeriodInput = z
  .object({
    kind: z.enum(["calendar", "rolling", "one_off"]),
    interval: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
    startsOn: z.string().date(),
    endsOn: z.string().date().nullable().optional(),
    rollingDays: z.number().int().min(1).max(366).optional(),
    fiscalStartMonth: z.number().int().min(1).max(12).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.endsOn !== undefined && p.endsOn !== null && p.endsOn < p.startsOn)
      ctx.addIssue({
        code: "custom",
        message: "End date must follow start date",
        path: ["endsOn"],
      });
    if (p.kind === "one_off" && (p.endsOn === undefined || p.endsOn === null))
      ctx.addIssue({ code: "custom", message: "One-off goals need a deadline", path: ["endsOn"] });
    if (p.kind === "rolling" && p.rollingDays === undefined)
      ctx.addIssue({ code: "custom", message: "Choose a rolling window", path: ["rollingDays"] });
  });
export const kpiScopeInput = z
  .object({ scope: z.enum(["company", "team", "user"]), scopeId: z.string().uuid().nullable() })
  .refine((s) => (s.scope === "company") === (s.scopeId === null), {
    message: "Choose an assignee for team or person scope",
    path: ["scopeId"],
  });
export const kpiGoalInput = kpiScopeInput
  .safeExtend({
    definitionId: z.string().uuid(),
    schemeId: z.string().uuid().nullable().optional(),
    name: z.string().trim().max(120).optional(),
    condition: kpiConditionInput,
    period: kpiPeriodInput,
    pacing: z.enum(["linear", "none"]),
  })
  .superRefine((g, ctx) => {
    if (g.condition.kind === "deadline" && g.period.kind !== "one_off")
      ctx.addIssue({
        code: "custom",
        message: "Deadline conditions need a one-off period",
        path: ["period"],
      });
    if (
      g.pacing === "linear" &&
      (g.condition.kind !== "at_least" ||
        Number(g.condition.target) <= 0 ||
        g.period.kind === "rolling")
    )
      ctx.addIssue({
        code: "custom",
        message: "Linear pacing is only available for positive accumulating minimum targets",
        path: ["pacing"],
      });
  });
export const kpiSchemeInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1200).default(""),
    entries: z
      .array(z.object({ definitionId: z.string().uuid(), condition: kpiConditionInput }))
      .min(1)
      .max(30),
  })
  .refine((s) => new Set(s.entries.map((e) => e.definitionId)).size === s.entries.length, {
    message: "A scorecard cannot contain the same KPI revision twice",
    path: ["entries"],
  });
export const kpiManualInput = z.object({
  goalId: z.string().uuid(),
  value: decimal,
  measuredOn: z.string().date(),
  sourceNote: z.string().trim().min(5).max(1200),
  sampleSize: z.number().int().min(1).max(100000000).optional(),
});
export const kpiRevisionInput = z
  .object({
    familyId: z.string().uuid().optional(),
    expectedRevision: z.number().int().min(1).optional(),
  })
  .refine((r) => (r.familyId === undefined) === (r.expectedRevision === undefined), {
    message: "Revisions require an expected current revision",
  });
