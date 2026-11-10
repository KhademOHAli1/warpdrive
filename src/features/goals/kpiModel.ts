/** Shared serializable KPI contracts. A revision is immutable once created. */
export const KPI_SOURCES = ["deals", "activities", "manual"] as const;
export const KPI_CALCULATIONS = [
  "count",
  "distinct_count",
  "sum",
  "average",
  "median",
  "duration",
  "percentage",
  "ratio",
] as const;
export const KPI_UNITS = ["count", "money", "percent", "hours", "days", "custom"] as const;
export const KPI_STATUSES = [
  "all",
  "won",
  "lost",
  "open",
  "closed",
  "completed",
  "overdue",
] as const;
export type KpiSource = (typeof KPI_SOURCES)[number];
export type KpiCalculation = (typeof KPI_CALCULATIONS)[number];
export type KpiUnit = (typeof KPI_UNITS)[number];
export type KpiStatus = (typeof KPI_STATUSES)[number];
export interface KpiDefinitionInput {
  name: string;
  description: string;
  source: KpiSource;
  calculation: KpiCalculation;
  unit: KpiUnit;
  customUnit?: string;
  currency?: string;
  dateField: "created" | "closed" | "completed" | "due" | "measured";
  filters: { pipelineId?: string | null; activityTypeId?: string | null; status?: KpiStatus };
  numeratorStatus?: KpiStatus;
  denominatorStatus?: KpiStatus;
  valueField?: "value" | "sales_cycle" | "duration";
  graph?: KpiGraph;
}
export const KPI_GRAPH_COMPUTE = [
  "add",
  "subtract",
  "multiply",
  "divide",
  "min",
  "max",
  "abs",
  "round",
  "percent",
] as const;
export const KPI_GRAPH_COMPARE = ["gt", "gte", "lt", "lte", "eq", "neq"] as const;
export type KpiGraphHandle = "a" | "b" | "condition" | "true" | "false" | "value";
export type KpiGraphNode = { id: string; label: string; position: { x: number; y: number } } & (
  | { type: "metric"; metric: Omit<KpiDefinitionInput, "graph"> }
  | { type: "constant"; value: string }
  | { type: "compute"; operation: (typeof KPI_GRAPH_COMPUTE)[number] }
  | { type: "compare"; operator: (typeof KPI_GRAPH_COMPARE)[number] }
  | { type: "logic"; operation: "and" | "or" | "not" }
  | { type: "branch" }
  | { type: "output" }
);
export interface KpiGraph {
  version: 1;
  nodes: KpiGraphNode[];
  edges: { id: string; source: string; target: string; targetHandle: KpiGraphHandle }[];
  outputNodeId: string;
}
export interface KpiGraphNodeResult {
  nodeId: string;
  type: "number" | "boolean";
  value: string | boolean | null;
  state: KpiMeasurement["state"];
  issues: string[];
  measurement?: KpiMeasurement;
}
export interface KpiDefinition extends KpiDefinitionInput {
  id: string;
  familyId: string;
  revision: number;
  createdAt: string;
}
export interface KpiCondition {
  kind: "at_least" | "at_most" | "range" | "improve" | "deadline";
  target: string;
  upperTarget?: string;
  baseline?: string;
  direction?: "increase" | "decrease";
}
export interface KpiPeriod {
  kind: "calendar" | "rolling" | "one_off";
  interval: "weekly" | "monthly" | "quarterly" | "yearly";
  startsOn: string;
  endsOn?: string | null;
  rollingDays?: number;
  fiscalStartMonth?: number;
}
export interface KpiScope {
  scope: "company" | "team" | "user";
  scopeId: string | null;
}
export interface KpiGoalInput extends KpiScope {
  definitionId: string;
  schemeId?: string | null;
  name?: string;
  condition: KpiCondition;
  period: KpiPeriod;
  pacing: "linear" | "none";
}
export interface KpiGoal extends KpiGoalInput {
  id: string;
  createdAt: string;
}
export interface KpiSchemeInput {
  name: string;
  description: string;
  entries: { definitionId: string; condition: KpiCondition }[];
}
export interface KpiScheme extends KpiSchemeInput {
  id: string;
  familyId: string;
  revision: number;
  createdAt: string;
}
export interface KpiContributor {
  id: string;
  label: string;
  href: string | null;
  value: string | null;
  included: boolean;
  reason: string | null;
  observedOn?: string | null;
  statuses?: KpiStatus[];
  numeratorMember?: boolean;
  denominatorMember?: boolean;
  nodeId?: string;
  nodeLabel?: string;
  recordId?: string;
}
export interface KpiMeasurement {
  state: "available" | "incomplete" | "unavailable" | "stale";
  value: string | null;
  recordCount: number;
  excludedCount: number;
  missingMeasurementDateCount?: number;
  numerator: number | null;
  denominator: number | null;
  sampleSize: number | null;
  contributors: KpiContributor[];
  contributorsTruncated: boolean;
  issues: string[];
  evaluatedAt: string;
  period: { start: string; end: string } | null;
  trend?: { day: string; value: string | null }[];
  nodeResults?: KpiGraphNodeResult[];
}
export interface KpiAssessment {
  standing: "met" | "not_met" | "in_progress" | "unavailable";
  attainment: number | null;
  pace: number | null;
}
export interface KpiGoalResult {
  goal: KpiGoal;
  scopeName?: string;
  definition: KpiDefinition;
  measurement: KpiMeasurement;
  assessment: KpiAssessment;
}
export interface KpiWorkspace {
  definitions: KpiDefinition[];
  referencedDefinitions?: KpiDefinition[];
  schemes: KpiScheme[];
  schemeLabels?: { id: string; name: string; revision: number }[];
  goals: KpiGoalResult[];
}
export type KpiActionResult<T> = { ok: true; value: T } | { ok: false; error: { id: string } };
export interface KpiManualInput {
  goalId: string;
  value: string;
  measuredOn: string;
  sourceNote: string;
  sampleSize?: number;
}
