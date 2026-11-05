import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { nativeError } from "./nativeErrors";
import {
  NATIVE_FILTER_OPERATORS,
  type NativeFieldMetadata,
  type NativeFilterOperator,
  nativeReferenceGate,
} from "./nativeFields";

export type NativeJson =
  | null
  | string
  | number
  | boolean
  | NativeJson[]
  | { [key: string]: NativeJson };
export interface NativeFilterCondition {
  field: string;
  operator: NativeFilterOperator;
  value?: NativeJson;
}
export interface NativeFilterGroup {
  combinator: "and" | "or";
  conditions: NativeFilter[];
}
export type NativeFilter = NativeFilterCondition | NativeFilterGroup;
const condition = z.strictObject({
  field: z.string().min(1).max(255),
  operator: z.enum(NATIVE_FILTER_OPERATORS),
  value: z.json().optional(),
});
export const nativeFilterSchema: z.ZodType<NativeFilter> = z.lazy(() =>
  z.union([
    condition,
    z.strictObject({
      combinator: z.enum(["and", "or"]),
      conditions: z.array(nativeFilterSchema).min(1).max(30),
    }),
  ]),
);
export const nativeFindSchema = z.strictObject({
  objectName: z.enum(["deal", "lead", "person", "organization", "activity"]),
  filters: z.union([z.array(nativeFilterSchema).max(30), nativeFilterSchema]).optional(),
  sort: z
    .strictObject({ field: z.string().min(1).max(255), direction: z.enum(["asc", "desc"]) })
    .optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).max(10_000).default(0),
});
export type NativeFindInput = z.input<typeof nativeFindSchema>;

const columns: Record<string, string> = {
  id: "id",
  title: "title",
  name: "name",
  firstName: "first_name",
  lastName: "last_name",
  subject: "subject",
  value: "value",
  currency: "currency",
  expectedCloseDate: "expected_close_date",
  status: "status",
  lostReason: "lost_reason",
  labels: "labels",
  sourceChannel: "source_channel",
  sourceChannelId: "source_channel_id",
  sourceOrigin: "source_origin",
  pipelineId: "pipeline_id",
  stageId: "stage_id",
  personId: "person_id",
  orgId: "org_id",
  dealId: "deal_id",
  leadId: "lead_id",
  ownerId: "owner_id",
  createdAt: "created_at",
  updatedAt: "updated_at",
  primaryEmail: "primary_email",
  emails: "emails",
  phones: "phones",
  address: "address",
  domain: "domain",
  industry: "industry",
  linkedinUrl: "linkedin_url",
  employeeCount: "employee_count",
  annualRevenue: "annual_revenue",
  typeId: "type_id",
  dueAt: "due_at",
  endAt: "end_at",
  allDay: "all_day",
  dueDate: "due_date",
  endDate: "end_date",
  durationMinutes: "duration_minutes",
  priority: "priority",
  done: "done",
  assigneeId: "assignee_id",
  location: "location",
  note: "note",
  videoCallUrl: "video_call_url",
};

export function nativeColumnName(key: string): string | undefined {
  return columns[key];
}

export function nativeFieldJson(field: NativeFieldMetadata): SQL {
  if (field.key.startsWith("customFields.")) return sql`r.custom_fields -> ${field.key.slice(13)}`;
  const column = columns[field.key];
  if (column === undefined) throw nativeError("workflow_native_field_invalid");
  return sql`to_jsonb(${sql.identifier("r")}.${sql.identifier(column)})`;
}

export function nativeFieldScalar(field: NativeFieldMetadata): SQL {
  const json = nativeFieldJson(field);
  if (field.format === "datetime")
    return sql`date_trunc('milliseconds',(${json} #>> '{}')::timestamptz)`;
  if (field.valueType === "number")
    return sql`CASE WHEN jsonb_typeof(${json})='number' THEN (${json} #>> '{}')::numeric END`;
  return sql`(${json} #>> '{}')`;
}

function equalClause(
  field: NativeFieldMetadata,
  value: NativeJson | undefined,
  negate: boolean,
): SQL {
  const operator = negate ? sql`IS DISTINCT FROM` : sql`IS NOT DISTINCT FROM`;
  if (field.format === "datetime")
    return sql`${nativeFieldScalar(field)} ${operator} date_trunc('milliseconds',${value}::timestamptz)`;
  if (typeof value === "string" && nativeReferenceGate(field.referenceObject) !== undefined)
    return sql`lower(${nativeFieldScalar(field)}) ${operator} ${value.toLowerCase()}`;
  const canonical =
    typeof value === "string" && field.format === "uuid" ? value.toLowerCase() : value;
  return sql`coalesce(${nativeFieldJson(field)},'null'::jsonb) ${operator} ${JSON.stringify(canonical)}::jsonb`;
}

function validValue(field: NativeFieldMetadata, value: NativeJson | undefined): boolean {
  if (value === null) return true;
  if (value === undefined) return false;
  if (field.valueType === "array") return Array.isArray(value);
  if (field.valueType === "object") return typeof value === "object" && !Array.isArray(value);
  if (field.valueType === "number") return typeof value === "number" && Number.isFinite(value);
  if (field.format === "date") return z.iso.date().safeParse(value).success;
  if (field.format === "datetime") return z.iso.datetime({ offset: true }).safeParse(value).success;
  if (field.format === "uuid") return z.uuid().safeParse(value).success;
  return typeof value === field.valueType;
}

function inClause(field: NativeFieldMetadata, value: NativeJson | undefined): SQL {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    !value.every((item) => validValue(field, item))
  )
    throw nativeError("workflow_native_filter_invalid");
  if (value.length === 0) return sql`FALSE`;
  return sql`(${sql.join(
    value.map((item) => equalClause(field, item, false)),
    sql` OR `,
  )})`;
}
function textClause(
  operator: "contains" | "starts_with",
  scalar: SQL,
  value: NativeJson | undefined,
): SQL {
  if (typeof value !== "string") throw nativeError("workflow_native_filter_invalid");
  return operator === "contains"
    ? sql`strpos(lower(${scalar}),lower(${value})) > 0`
    : sql`left(lower(${scalar}),length(${value})) = lower(${value})`;
}

function leafSql(filter: NativeFilterCondition, fields: NativeFieldMetadata[]): SQL {
  const field = fields.find((candidate) => candidate.key === filter.field);
  if (field?.readable !== true || !field.filterOperators.includes(filter.operator))
    throw nativeError("workflow_native_filter_invalid");
  const json = nativeFieldJson(field);
  const scalar = nativeFieldScalar(field);
  const value = filter.value;
  const empty = sql`(${json} IS NULL OR ${json} IN ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb))`;
  if (filter.operator === "is_empty") return empty;
  if (filter.operator === "is_not_empty") return sql`NOT ${empty}`;
  if (filter.operator === "in") return inClause(field, value);
  if (filter.operator === "contains" && field.valueType === "array") {
    if (value === undefined) throw nativeError("workflow_native_filter_invalid");
    return sql`${json} @> ${JSON.stringify(Array.isArray(value) ? value : [value])}::jsonb`;
  }
  if (!validValue(field, value)) throw nativeError("workflow_native_filter_invalid");
  if (filter.operator === "eq" || filter.operator === "ne")
    return equalClause(field, value, filter.operator === "ne");
  if (filter.operator === "contains" || filter.operator === "starts_with")
    return textClause(filter.operator, scalar, value);
  const comparisons: Partial<Record<NativeFilterOperator, SQL>> = {
    gt: sql`>`,
    gte: sql`>=`,
    lt: sql`<`,
    lte: sql`<=`,
  };
  const operator = comparisons[filter.operator];
  if (operator === undefined || value === null) throw nativeError("workflow_native_filter_invalid");
  return sql`${scalar} ${operator} ${value}`;
}

export function compileNativeFilters(
  input: NativeFilter | NativeFilter[] | undefined,
  fields: NativeFieldMetadata[],
): SQL {
  let count = 0;
  function compile(filter: NativeFilter, depth: number): SQL {
    if (++count > 100 || depth > 5) throw nativeError("workflow_native_filter_invalid");
    if (!("conditions" in filter)) return leafSql(filter, fields);
    const parts = filter.conditions.map((child) => compile(child, depth + 1));
    return sql`(${sql.join(parts, filter.combinator === "or" ? sql` OR ` : sql` AND `)})`;
  }
  if (input === undefined || (Array.isArray(input) && input.length === 0)) return sql`TRUE`;
  return Array.isArray(input)
    ? compile({ combinator: "and", conditions: input }, 0)
    : compile(input, 0);
}
