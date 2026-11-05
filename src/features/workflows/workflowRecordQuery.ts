import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { contactVisibilityClause } from "@/features/contacts/visibilitySql";
import { dealVisibilityClause } from "@/features/deals/visibility";
import { leadVisibilityClause } from "@/features/leads/visibility";
import type { PermSetUser } from "@/features/permissions/effective";
import { activityVisibilityPredicate } from "@/features/stats/activityVisibilitySql";
import { err, ok, type Result } from "@/types/result";
import { isExactMappingDecimal } from "./mappingCompatibility";
import { isMappingDate, isMappingInstant } from "./mappingLiteralIntent";
import { resolveRunBinding } from "./runBindings";
import type { RunOutputs, StepOutput } from "./runTypes";
import type { DraftBinding, WorkflowDefinition, WorkflowNode } from "./schemas";
import {
  type RecordLookupEntity,
  type RecordPickRelationField,
  type RecordSearchField,
  type RecordSearchFilterCondition,
  type RecordSearchFilterEntry,
  type RecordSearchOperator,
  recordSearchConfig,
  recordSearchFieldContract,
  recordSearchFields,
  recordSearchOperatorNeedsValue,
  recordSearchPageAmount,
} from "./workflowRecordQueryContract";

const fieldColumns: Record<RecordSearchField | RecordPickRelationField, string> = {
  id: "id",
  title: "title",
  name: "name",
  subject: "subject",
  status: "status",
  value: "value",
  currency: "currency",
  expectedCloseDate: "expected_close_date",
  dueAt: "due_at",
  done: "done",
  createdAt: "created_at",
  updatedAt: "updated_at",
  dealId: "deal_id",
  leadId: "lead_id",
  personId: "person_id",
  orgId: "org_id",
};

function column(alias: string, key: string): SQL {
  return sql`${sql.identifier(alias)}.${sql.identifier(key)}`;
}

export function visibleWorkflowRecordSource(entity: RecordLookupEntity, actor: PermSetUser) {
  const session = {
    userId: actor.id,
    isActive: actor.isActive,
    isAdmin: actor.type === "admin",
    sessionLive: true,
    visibilityGroupIds: Array.from(actor.groupIds),
    managedUserIds: Array.from(actor.managedUserIds ?? []),
  };
  const contact = contactVisibilityClause(session, {
    ownerId: sql`r.owner_id`,
    visibilityLevel: sql`r.visibility_level`,
    visibilityGroupId: sql`r.visibility_group_id`,
    visibleToUserIds: sql`r.visible_to_user_ids`,
  });
  const sources = {
    deal: {
      alias: "d",
      from: sql`deals d JOIN pipelines p ON p.id = d.pipeline_id`,
      visible: sql`p.is_archived = false AND ${dealVisibilityClause(session)}`,
    },
    lead: { alias: "leads", from: sql`leads`, visible: leadVisibilityClause(session) },
    person: { alias: "r", from: sql`persons r`, visible: contact },
    organization: { alias: "r", from: sql`organizations r`, visible: contact },
    activity: {
      alias: "r",
      from: sql`activities r JOIN activity_types t ON t.id = r.type_id`,
      visible: sql`t.key = 'task' AND t.archived_at IS NULL AND (${activityVisibilityPredicate(actor, "r")})`,
    },
  };
  const { alias, from, visible } = sources[entity];
  return {
    from,
    visible: sql`${column(alias, "deleted_at")} IS NULL AND (${visible})`,
    field: (field: RecordSearchField | RecordPickRelationField) => {
      const value = column(alias, fieldColumns[field]);
      return field === "status" ? sql`${value}::text` : value;
    },
  };
}

type RecordSource = ReturnType<typeof visibleWorkflowRecordSource>;
export type WorkflowRecordSnapshot = { id: string } & Record<string, string | boolean | null>;

function snapshotValue(entity: RecordLookupEntity, field: RecordSearchField, source: RecordSource) {
  const value = source.field(field);
  const { kind } = recordSearchFieldContract(entity, field);
  if (kind === "instant")
    return sql`to_char(${value} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  if (kind === "decimal" || kind === "date") return sql`${value}::text`;
  if (kind === "text") return sql`left(${value}::text, 255)`;
  return value;
}

export function workflowRecordSnapshotSql(entity: RecordLookupEntity, source: RecordSource): SQL {
  return sql`jsonb_build_object(${sql.join(
    recordSearchFields[entity].map(
      (field) => sql`${field}::text, ${snapshotValue(entity, field, source)}`,
    ),
    sql`, `,
  )})`;
}

function validValue(
  entity: RecordLookupEntity,
  field: RecordSearchField,
  raw: unknown,
): raw is string | boolean | null {
  const { kind, nullable } = recordSearchFieldContract(entity, field);
  if (raw === null) return nullable;
  if (kind === "entity") return z.uuid().safeParse(raw).success;
  if (kind === "boolean") return typeof raw === "boolean";
  if (kind === "date") return isMappingDate(raw);
  if (kind === "instant") return isMappingInstant(raw);
  if (kind === "decimal") return isExactMappingDecimal(raw) && raw.length <= 40;
  return typeof raw === "string" && Array.from(raw).length <= 255;
}

export function workflowRecordSnapshot(
  entity: RecordLookupEntity,
  raw: unknown,
): WorkflowRecordSnapshot | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || !validValue(entity, "id", record.id)) return null;
  const snapshot: WorkflowRecordSnapshot = { id: record.id };
  for (const field of recordSearchFields[entity]) {
    if (field === "id") continue;
    const value = Object.hasOwn(record, field) ? record[field] : undefined;
    if (!validValue(entity, field, value)) return null;
    snapshot[field] = value;
  }
  return snapshot;
}

export function workflowRecordIdList(ids: readonly string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

type LookupNode = Pick<WorkflowNode, "id" | "config"> & { version: unknown };
interface SearchContext {
  definition: WorkflowDefinition;
  nodeId: string;
  outputs: RunOutputs;
  entity: RecordLookupEntity;
  source: RecordSource;
}

function resolveSearchInput(
  binding: DraftBinding,
  path: readonly string[],
  context: SearchContext,
) {
  const resolved = resolveRunBinding(
    binding,
    context.outputs,
    binding.kind === "reference"
      ? { definition: context.definition, nodeId: context.nodeId, path }
      : undefined,
  );
  if (resolved.state === "invalid") return err(ERROR_IDS.WORKFLOW_INVALID);
  return resolved.state === "value" ? ok(resolved.value) : err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
}

function searchPage(
  binding: DraftBinding | undefined,
  kind: "limit" | "offset",
  context: SearchContext,
) {
  if (binding === undefined) return ok(kind === "limit" ? 1 : 0);
  const value = resolveSearchInput(binding, [kind], context);
  if (!value.ok) return value;
  const amount = recordSearchPageAmount(value.value, kind);
  return amount === null ? err(ERROR_IDS.WORKFLOW_INVALID) : ok(amount);
}

function comparison(
  column: SQL,
  operator: RecordSearchOperator,
  value: string | number | boolean,
): SQL {
  const text = sql`lower(${column}::text)`;
  const needle = sql`lower(${value}::text)`;
  switch (operator) {
    case "equals":
      return sql`${column} = ${value}`;
    case "notEquals":
      return sql`${column} <> ${value}`;
    case "lessThan":
      return sql`${column} < ${value}`;
    case "atMost":
      return sql`${column} <= ${value}`;
    case "greaterThan":
      return sql`${column} > ${value}`;
    case "atLeast":
      return sql`${column} >= ${value}`;
    case "contains":
      return sql`strpos(${text}, ${needle}) > 0`;
    case "notContains":
      return sql`strpos(${text}, ${needle}) = 0`;
    case "startsWith":
      return sql`left(${text}, length(${needle})) = ${needle}`;
    case "endsWith":
      return sql`right(${text}, length(${needle})) = ${needle}`;
    case "isEmpty":
    case "isNotEmpty":
      return sql`FALSE`;
  }
}

function emptyPredicate(
  entity: RecordLookupEntity,
  field: RecordSearchField,
  column: SQL,
  operator: RecordSearchOperator,
) {
  const empty =
    recordSearchFieldContract(entity, field).kind === "text"
      ? sql`(${column} IS NULL OR btrim(${column}::text) = '')`
      : sql`(${column} IS NULL)`;
  return operator === "isEmpty" ? empty : sql`NOT ${empty}`;
}

function compileCondition(
  entry: RecordSearchFilterCondition,
  context: SearchContext,
  path: readonly string[],
): Result<SQL, string> {
  const column = context.source.field(entry.field);
  if (!recordSearchOperatorNeedsValue(entry.operator))
    return ok(emptyPredicate(context.entity, entry.field, column, entry.operator));
  if (entry.value === undefined) return err(ERROR_IDS.WORKFLOW_INVALID);
  const resolved = resolveSearchInput(entry.value, [...path, "value"], context);
  if (!resolved.ok) return resolved;
  const kind = recordSearchFieldContract(context.entity, entry.field).kind;
  const value =
    kind === "decimal" && typeof resolved.value === "number"
      ? String(resolved.value)
      : resolved.value;
  if (kind === "text" && typeof value === "string" && value.trim() === "")
    return err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
  if (!validValue(context.entity, entry.field, value)) return err(ERROR_IDS.WORKFLOW_INVALID);
  return ok(comparison(column, entry.operator, value));
}

function compileFilter(
  entry: RecordSearchFilterEntry,
  context: SearchContext,
  path: readonly string[],
): Result<SQL, string> {
  if (entry.kind === "condition") return compileCondition(entry, context, path);
  const children: SQL[] = [];
  for (const [index, child] of entry.entries.entries()) {
    const compiled = compileFilter(child, context, [...path, "entries", String(index)]);
    if (!compiled.ok) return compiled;
    children.push(compiled.value);
  }
  return ok(sql`(${sql.join(children, entry.combinator === "and" ? sql` AND ` : sql` OR `)})`);
}

export async function searchWorkflowRecords(
  db: Db,
  actor: PermSetUser,
  node: LookupNode,
  outputs: RunOutputs,
  definition: WorkflowDefinition,
  signal: AbortSignal,
): Promise<Result<StepOutput, string>> {
  signal.throwIfAborted();
  if (!actor.isActive) return err(ERROR_IDS.WORKFLOW_DENIED);
  const parsed = recordSearchConfig.safeParse(node.config);
  if (!parsed.success || node.version !== 1) return err(ERROR_IDS.WORKFLOW_INVALID);
  const { entity, filter, orderBy, limit, offset } = parsed.data;
  const source = visibleWorkflowRecordSource(entity, actor);
  const context = { definition, outputs, nodeId: node.id, entity, source };
  const take = searchPage(limit, "limit", context);
  if (!take.ok) return take;
  const skip = searchPage(offset, "offset", context);
  if (!skip.ok) return skip;
  const where = filter === undefined ? ok(sql`TRUE`) : compileFilter(filter, context, ["filter"]);
  if (!where.ok) return where;
  const orders = (orderBy ?? []).map(
    (item) =>
      sql`${source.field(item.field)} ${item.direction === "asc" ? sql`ASC` : sql`DESC`} NULLS LAST`,
  );
  if (orderBy?.some((item) => item.field === "id") !== true)
    orders.push(sql`${source.field("id")} ASC`);
  const order = sql.join(orders, sql`, `);
  const from = sql`FROM ${source.from} WHERE ${source.visible} AND ${where.value}`;
  const { rows } = await db.execute<{ records: unknown; totalCount: string }>(sql`
    WITH page AS (
      SELECT ${workflowRecordSnapshotSql(entity, source)} AS record, row_number() OVER (ORDER BY ${order}) AS ordinal
      ${from} ORDER BY ${order} LIMIT ${take.value} OFFSET ${skip.value}
    )
    SELECT COALESCE(jsonb_agg(record ORDER BY ordinal), '[]'::jsonb) AS records,
      (SELECT count(*)::text ${from}) AS "totalCount"
    FROM page
  `);
  signal.throwIfAborted();
  const row = rows[0];
  const totalCount = Number(row?.totalCount);
  if (
    row === undefined ||
    !Array.isArray(row.records) ||
    row.records.length > take.value ||
    !Number.isSafeInteger(totalCount) ||
    totalCount < row.records.length
  )
    return err(ERROR_IDS.WORKFLOW_INVALID);
  const all: WorkflowRecordSnapshot[] = [];
  const records: unknown[] = row.records;
  for (const raw of records) {
    const record = workflowRecordSnapshot(entity, raw);
    if (record === null) return err(ERROR_IDS.WORKFLOW_INVALID);
    all.push(record);
  }
  const first = all[0] ?? null;
  return ok({ first, all, totalCount, firstId: first?.id ?? null });
}
