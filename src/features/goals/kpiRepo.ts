import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { activityTypes } from "@/db/schema/activityTypes";
import { teams, users } from "@/db/schema/identity";
import {
  kpiDefinitions,
  kpiGoals,
  kpiMeasurements,
  kpiSchemes,
  kpiSnapshots,
} from "@/db/schema/kpis";
import { pipelines } from "@/db/schema/pipelines";
import { dealVisibilityClause } from "@/features/deals/visibility";
import { getPreferencesForActor } from "@/features/identity/preferencesForActor";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { activityVisibilityPredicate } from "@/features/stats/activityVisibilitySql";
import { goalSession } from "./goalSql";
import {
  assessKpi,
  evaluateKpiRecords,
  type KpiRecord,
  kpiPeriodBounds,
  unavailableKpi,
} from "./kpiEngine";
import { evaluateKpiGraph } from "./kpiGraph";
import type {
  KpiDefinition,
  KpiDefinitionInput,
  KpiGoal,
  KpiGoalInput,
  KpiGoalResult,
  KpiMeasurement,
  KpiPeriod,
  KpiScheme,
  KpiSchemeInput,
  KpiScope,
  KpiWorkspace,
} from "./kpiModel";
import { kpiTrend } from "./kpiTrend";
import { todayInZone } from "./todayInZone";

type KpiDb = Pick<Db, "select" | "insert" | "update" | "execute">;
export class KpiError extends Error {
  constructor(public readonly id: string) {
    super(id);
    this.name = "KpiError";
  }
}
async function filtersAvailable(
  db: KpiDb,
  actor: PermSetUser,
  definition: KpiDefinitionInput,
): Promise<boolean> {
  if (definition.graph !== undefined) return graphFiltersAvailable(db, actor, definition.graph);
  if (hasKpiId(definition.filters.pipelineId)) {
    const groups = Array.from(actor.groupIds);
    const visibility =
      actor.type === "admin"
        ? sql`true`
        : sql`(${pipelines.visibilityGroupId} IS NULL OR ${groups.length ? inArray(pipelines.visibilityGroupId, groups) : sql`false`})`;
    const [row] = await db
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(
        and(
          eq(pipelines.id, definition.filters.pipelineId),
          eq(pipelines.isArchived, false),
          visibility,
        ),
      );
    if (!row) return false;
  }
  if (hasKpiId(definition.filters.activityTypeId)) {
    const [row] = await db
      .select({ id: activityTypes.id })
      .from(activityTypes)
      .where(
        and(
          eq(activityTypes.id, definition.filters.activityTypeId),
          isNull(activityTypes.archivedAt),
        ),
      );
    if (!row) return false;
  }
  return true;
}
async function graphFiltersAvailable(
  db: KpiDb,
  actor: PermSetUser,
  graph: NonNullable<KpiDefinitionInput["graph"]>,
): Promise<boolean> {
  for (const node of graph.nodes.filter((node) => node.type === "metric")) {
    if (node.metric.source === "manual" || !(await filtersAvailable(db, actor, node.metric)))
      return false;
  }
  return true;
}
const defDto = (row: typeof kpiDefinitions.$inferSelect): KpiDefinition => ({
  ...row.definition,
  id: row.id,
  familyId: row.familyId,
  revision: row.revision,
  createdAt: row.createdAt.toISOString(),
});
const schemeDto = (row: typeof kpiSchemes.$inferSelect): KpiScheme => ({
  ...row.definition,
  id: row.id,
  familyId: row.familyId,
  revision: row.revision,
  createdAt: row.createdAt.toISOString(),
});
const goalDto = (row: typeof kpiGoals.$inferSelect): KpiGoal => ({
  ...row.assignment,
  id: row.id,
  definitionId: row.definitionId,
  schemeId: row.schemeId,
  createdAt: row.createdAt.toISOString(),
});

export async function kpiScopeVisible(
  db: KpiDb,
  actor: PermSetUser,
  scope: KpiScope,
): Promise<boolean> {
  if (
    can(actor, "stats.viewOthers") ||
    scope.scope === "company" ||
    (scope.scope === "user" && scope.scopeId === actor.id)
  )
    return true;
  if (scope.scope !== "team") return false;
  const result = await db.execute(
    sql`SELECT 1 FROM team_members WHERE user_id=${actor.id}::uuid AND team_id=${scope.scopeId}::uuid LIMIT 1`,
  );
  return (result as unknown as { rows: unknown[] }).rows.length > 0;
}
export async function kpiScopeExists(db: KpiDb, scope: KpiScope): Promise<boolean> {
  if (scope.scope === "company") return scope.scopeId === null;
  const table = scope.scope === "user" ? sql`users` : sql`teams`;
  const result = await db.execute(
    sql`SELECT id FROM ${table} WHERE id=${scope.scopeId}::uuid LIMIT 1`,
  );
  return (result as unknown as { rows: unknown[] }).rows.length > 0;
}
export async function getKpiDefinition(db: KpiDb, id: string): Promise<KpiDefinition> {
  const [row] = await db.select().from(kpiDefinitions).where(eq(kpiDefinitions.id, id));
  if (!row) throw new KpiError("E_KPI_NOT_FOUND");
  return defDto(row);
}
export async function getKpiGoal(db: KpiDb, id: string): Promise<KpiGoal> {
  const [row] = await db
    .select()
    .from(kpiGoals)
    .where(and(eq(kpiGoals.id, id), isNull(kpiGoals.archivedAt)));
  if (!row) throw new KpiError("E_KPI_NOT_FOUND");
  return goalDto(row);
}
export async function saveKpiDefinition(
  db: KpiDb,
  actor: PermSetUser,
  input: KpiDefinitionInput,
  revision: { familyId?: string; expectedRevision?: number },
): Promise<KpiDefinition> {
  if (!(await filtersAvailable(db, actor, input))) throw new KpiError("E_KPI_INVALID");
  let next = 1;
  if (revision.familyId !== undefined) {
    const [head] = await db
      .select()
      .from(kpiDefinitions)
      .where(eq(kpiDefinitions.familyId, revision.familyId))
      .orderBy(desc(kpiDefinitions.revision))
      .limit(1);
    if (!head || head.revision !== revision.expectedRevision) throw new KpiError("E_KPI_CONFLICT");
    next = head.revision + 1;
  }
  const [row] = await db
    .insert(kpiDefinitions)
    .values({
      definition: input,
      familyId: revision.familyId ?? crypto.randomUUID(),
      revision: next,
      createdBy: actor.id,
    })
    .returning();
  if (!row) throw new KpiError("E_KPI_FAILED");
  return defDto(row);
}
export async function saveKpiScheme(
  db: KpiDb,
  actor: PermSetUser,
  input: KpiSchemeInput,
  revision: { familyId?: string; expectedRevision?: number },
): Promise<KpiScheme> {
  const ids = input.entries.map((e) => e.definitionId);
  const definitions = await db.select().from(kpiDefinitions).where(inArray(kpiDefinitions.id, ids));
  if (definitions.length !== ids.length) throw new KpiError("E_KPI_INVALID");
  for (const entry of input.entries) {
    const definition = definitions.find((d) => d.id === entry.definitionId)?.definition;
    if (
      definition &&
      definition.graph === undefined &&
      ["count", "distinct_count"].includes(definition.calculation) &&
      (!Number.isInteger(Number(entry.condition.target)) || Number(entry.condition.target) < 0)
    )
      throw new KpiError("E_KPI_INVALID");
  }
  let next = 1;
  if (revision.familyId !== undefined) {
    const [head] = await db
      .select()
      .from(kpiSchemes)
      .where(eq(kpiSchemes.familyId, revision.familyId))
      .orderBy(desc(kpiSchemes.revision))
      .limit(1);
    if (!head || head.revision !== revision.expectedRevision) throw new KpiError("E_KPI_CONFLICT");
    next = head.revision + 1;
  }
  const [row] = await db
    .insert(kpiSchemes)
    .values({
      definition: input,
      familyId: revision.familyId ?? crypto.randomUUID(),
      revision: next,
      createdBy: actor.id,
    })
    .returning();
  if (!row) throw new KpiError("E_KPI_FAILED");
  return schemeDto(row);
}
export async function assignKpiGoal(
  db: KpiDb,
  actor: PermSetUser,
  input: KpiGoalInput,
): Promise<KpiGoal> {
  const definition = await getKpiDefinition(db, input.definitionId);
  if (!(await kpiScopeExists(db, input))) throw new KpiError("E_KPI_INVALID");
  if (
    input.pacing === "linear" &&
    (definition.graph !== undefined ||
      !["count", "distinct_count", "sum"].includes(definition.calculation))
  )
    throw new KpiError("E_KPI_INVALID");
  if (
    definition.graph === undefined &&
    ["count", "distinct_count"].includes(definition.calculation) &&
    (!Number.isInteger(Number(input.condition.target)) || Number(input.condition.target) < 0)
  )
    throw new KpiError("E_KPI_INVALID");
  if (hasKpiId(input.schemeId)) {
    const [scheme] = await db.select().from(kpiSchemes).where(eq(kpiSchemes.id, input.schemeId));
    const entry = scheme?.definition.entries.find((e) => e.definitionId === definition.id);
    if (
      !entry ||
      (["kind", "target", "upperTarget", "baseline", "direction"] as const).some(
        (key) => entry.condition[key] !== input.condition[key],
      )
    )
      throw new KpiError("E_KPI_INVALID");
  }
  const [row] = await db
    .insert(kpiGoals)
    .values({
      definitionId: definition.id,
      schemeId: input.schemeId ?? null,
      assignment: input,
      createdBy: actor.id,
    })
    .returning();
  if (!row) throw new KpiError("E_KPI_FAILED");
  return goalDto(row);
}

function ownerScope(scope: KpiScope, column: ReturnType<typeof sql>) {
  if (scope.scope === "company") return sql``;
  if (scope.scope === "user") return sql`AND ${column}=${scope.scopeId}::uuid`;
  return sql`AND ${column} IN (SELECT user_id FROM team_members WHERE team_id=${scope.scopeId}::uuid)`;
}

type KpiClock = { day: string; instant: string; timeZone?: string | null };
type KpiBounds = NonNullable<KpiMeasurement["period"]>;
function hasKpiId(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value !== "";
}
function evaluationTimeZone(clock: KpiClock | undefined): string {
  const timeZone = clock?.timeZone ?? "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}
function timestampWindow(bounds: KpiBounds, timeZone: string) {
  return {
    from: sql`(${bounds.start}::date::timestamp AT TIME ZONE ${timeZone})`,
    toExclusive: sql`((${bounds.end}::date+INTERVAL '1 day') AT TIME ZONE ${timeZone})`,
  };
}
async function manualRecords(db: KpiDb, goalId: string, bounds: KpiBounds): Promise<KpiRecord[]> {
  const rows = await db
    .select()
    .from(kpiMeasurements)
    .where(
      and(
        eq(kpiMeasurements.goalId, goalId),
        sql`${kpiMeasurements.measuredOn}>=${bounds.start}::date`,
        sql`${kpiMeasurements.measuredOn}<=${bounds.end}::date`,
      ),
    )
    .orderBy(desc(kpiMeasurements.measuredOn), desc(kpiMeasurements.createdAt))
    .limit(10001);
  return rows.map((r) => ({
    id: r.id,
    label: r.sourceNote,
    href: null,
    value: r.value,
    statuses: ["all"],
    sampleSize: r.sampleSize,
    measuredOn: r.measuredOn,
    observedOn: r.measuredOn,
  }));
}
async function dealRecords(
  db: KpiDb,
  actor: PermSetUser,
  definition: KpiDefinitionInput,
  scope: KpiScope,
  bounds: KpiBounds,
  timeZone: string,
): Promise<KpiRecord[]> {
  const { from, toExclusive } = timestampWindow(bounds, timeZone);
  const at =
    definition.dateField === "closed"
      ? sql`CASE WHEN d.status='won' THEN d.won_time WHEN d.status='lost' THEN d.lost_time ELSE NULL END`
      : sql`d.created_at`;
  const value =
    definition.valueField === "sales_cycle"
      ? sql`round((extract(epoch FROM ((CASE WHEN d.status='won' THEN d.won_time WHEN d.status='lost' THEN d.lost_time ELSE NULL END)-d.created_at))/${definition.unit === "hours" ? 3600 : 86400})::numeric,4)::text`
      : sql`d.value::text`;
  const pipelineFilter = hasKpiId(definition.filters.pipelineId)
    ? sql`AND d.pipeline_id=${definition.filters.pipelineId}::uuid`
    : sql``;
  const missingDate =
    definition.dateField === "closed"
      ? sql`d.status IN ('won','lost') AND (${at}) IS NULL`
      : sql`false`;
  const result = await db.execute(
    sql`SELECT d.id,d.title AS label,d.status,d.currency,((${at}) AT TIME ZONE ${timeZone})::date::text AS observed_on,(${missingDate}) AS missing_measurement_date,${value} AS value FROM deals d JOIN pipelines p ON p.id=d.pipeline_id WHERE d.deleted_at IS NULL AND d.archived_at IS NULL AND p.is_archived=false AND (((${at})>=${from} AND (${at})<${toExclusive}) OR (${missingDate})) ${pipelineFilter} ${ownerScope(scope, sql`d.owner_id`)} AND ${dealVisibilityClause(goalSession(actor))} ORDER BY d.id LIMIT 10001`,
  );
  const rows = (
    result as unknown as {
      rows: {
        id: string;
        label: string;
        status: "won" | "lost" | "open";
        currency: string;
        value: string | null;
        observed_on: string | null;
        missing_measurement_date: boolean;
      }[];
    }
  ).rows;
  return rows.map((r) => ({
    ...r,
    href: `/deals/${r.id}`,
    observedOn: r.observed_on ?? undefined,
    missingMeasurementDate: r.missing_measurement_date,
    statuses: r.status === "open" ? ["open"] : [r.status, "closed"],
  }));
}
async function activityRecords(
  db: KpiDb,
  actor: PermSetUser,
  definition: KpiDefinitionInput,
  scope: KpiScope,
  bounds: KpiBounds,
  on: string,
  timeZone: string,
  clock: KpiClock | undefined,
): Promise<KpiRecord[]> {
  const { from, toExclusive } = timestampWindow(bounds, timeZone);
  // All-day due_date is canonical; timed activities retain their instant due_at.
  const due = sql`CASE WHEN a.all_day AND a.due_date IS NOT NULL THEN a.due_date::timestamp ELSE a.due_at END`;
  const at =
    definition.dateField === "due"
      ? due
      : definition.dateField === "completed"
        ? sql`a.done_at`
        : sql`a.created_at`;
  const value = sql`round((a.duration_minutes::numeric/${definition.unit === "days" ? 1440 : 60}),4)::text`;
  const overdue = sql`CASE WHEN a.all_day AND a.due_date IS NOT NULL THEN a.due_date<${clock?.day ?? on}::date ELSE a.due_at<${clock?.instant ?? new Date().toISOString()}::timestamptz END`;
  const window =
    definition.dateField === "due"
      ? sql`CASE WHEN a.all_day AND a.due_date IS NOT NULL THEN a.due_date>=${bounds.start}::date AND a.due_date<=${bounds.end}::date ELSE a.due_at>=${from} AND a.due_at<${toExclusive} END`
      : sql`(${at})>=${from} AND (${at})<${toExclusive}`;
  const observed =
    definition.dateField === "due"
      ? sql`CASE WHEN a.all_day AND a.due_date IS NOT NULL THEN a.due_date::text ELSE (a.due_at AT TIME ZONE ${timeZone})::date::text END`
      : sql`((${at}) AT TIME ZONE ${timeZone})::date::text`;
  const typeFilter = hasKpiId(definition.filters.activityTypeId)
    ? sql`AND a.type_id=${definition.filters.activityTypeId}::uuid`
    : sql``;
  const pipelineFilter = hasKpiId(definition.filters.pipelineId)
    ? sql`AND EXISTS(SELECT 1 FROM deals d3 WHERE d3.id=a.deal_id AND d3.pipeline_id=${definition.filters.pipelineId}::uuid)`
    : sql``;
  const missingDate =
    definition.dateField === "completed" ? sql`a.done=true AND a.done_at IS NULL` : sql`false`;
  const result = await db.execute(
    sql`SELECT a.id,a.subject AS label,a.done,${observed} AS observed_on,(${missingDate}) AS missing_measurement_date,${overdue} AS overdue,${value} AS value FROM activities a WHERE a.deleted_at IS NULL AND ((${window}) OR (${missingDate})) ${typeFilter} ${pipelineFilter} ${ownerScope(scope, sql`a.assignee_id`)} AND ${activityVisibilityPredicate(actor, "a")} ORDER BY a.id LIMIT 10001`,
  );
  const rows = (
    result as unknown as {
      rows: {
        id: string;
        label: string;
        done: boolean;
        overdue: boolean;
        value: string | null;
        observed_on: string | null;
        missing_measurement_date: boolean;
      }[];
    }
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    href: null,
    value: r.value,
    observedOn: r.observed_on ?? undefined,
    missingMeasurementDate: r.missing_measurement_date,
    statuses: r.done ? ["completed"] : r.overdue ? ["open", "overdue"] : ["open"],
  }));
}
export async function evaluateKpi(
  db: KpiDb,
  actor: PermSetUser,
  definition: KpiDefinitionInput,
  scope: KpiScope,
  period: KpiPeriod,
  on: string,
  signal: AbortSignal,
  goalId?: string,
  clock?: KpiClock,
): Promise<KpiMeasurement> {
  signal.throwIfAborted();
  const bounds = kpiPeriodBounds(period, on);
  if (bounds === null) return unavailableKpi("outside_goal_period", null);
  if (!(await kpiScopeVisible(db, actor, scope))) throw new KpiError("E_PERM_DENIED");
  if (!(await filtersAvailable(db, actor, definition)))
    return unavailableKpi("source_unavailable", bounds);
  if (definition.graph !== undefined)
    return evaluateKpiGraph(
      definition.graph,
      (metric) => evaluateKpi(db, actor, metric, scope, period, on, signal, undefined, clock),
      {
        period: bounds,
        unit: definition.unit,
        currency: definition.currency,
        customUnit: definition.customUnit,
      },
    );
  const timeZone = evaluationTimeZone(clock);
  let records: KpiRecord[];
  switch (definition.source) {
    case "manual":
      if (!hasKpiId(goalId)) return unavailableKpi("no_manual_measurements", bounds);
      records = await manualRecords(db, goalId, bounds);
      if (records.length === 0) return unavailableKpi("no_manual_measurements", bounds);
      break;
    case "deals":
      records = await dealRecords(db, actor, definition, scope, bounds, timeZone);
      break;
    case "activities":
      records = await activityRecords(db, actor, definition, scope, bounds, on, timeZone, clock);
  }
  signal.throwIfAborted();
  const result = evaluateKpiRecords(definition, records.slice(0, 10000), bounds, {
    truncated: records.length > 10000,
    on,
  });
  if (definition.source !== "manual")
    result.issues.push("current_record_state", "date_field_required");
  if (records.length <= 10000) result.trend = kpiTrend(definition, records, bounds, on);
  return result;
}

function scopeNameKey(scope: KpiScope): string {
  return `${scope.scope}:${scope.scopeId ?? ""}`;
}
async function readScopeName(db: KpiDb, scope: KpiScope): Promise<string | undefined> {
  if (scope.scope === "company" || scope.scopeId === null) return undefined;
  const table = scope.scope === "user" ? users : teams;
  const [row] = await db
    .select({ name: table.name })
    .from(table)
    .where(eq(table.id, scope.scopeId));
  return row?.name;
}
async function visibleScopeNames(
  db: KpiDb,
  visible: KpiGoal[],
): Promise<ReadonlyMap<string, string>> {
  const userIds = Array.from(
    new Set(
      visible.flatMap((goal) =>
        goal.scope === "user" && hasKpiId(goal.scopeId) ? [goal.scopeId] : [],
      ),
    ),
  );
  const teamIds = Array.from(
    new Set(
      visible.flatMap((goal) =>
        goal.scope === "team" && hasKpiId(goal.scopeId) ? [goal.scopeId] : [],
      ),
    ),
  );
  const [people, groups] = await Promise.all([
    userIds.length > 0
      ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))
      : Promise.resolve([]),
    teamIds.length > 0
      ? db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds))
      : Promise.resolve([]),
  ]);
  const names = new Map<string, string>();
  for (const person of people) names.set(`user:${person.id}`, person.name);
  for (const group of groups) names.set(`team:${group.id}`, group.name);
  return names;
}

export async function readKpiGoalResult(
  db: KpiDb,
  actor: PermSetUser,
  goal: KpiGoal,
  on: string,
  signal: AbortSignal,
  clock?: KpiClock,
  scopeNames?: ReadonlyMap<string, string>,
): Promise<KpiGoalResult> {
  if (!(await kpiScopeVisible(db, actor, goal))) throw new KpiError("E_PERM_DENIED");
  const scopeName =
    scopeNames === undefined ? await readScopeName(db, goal) : scopeNames.get(scopeNameKey(goal));
  const definition = await getKpiDefinition(db, goal.definitionId);
  const bounds = kpiPeriodBounds(goal.period, on);
  if (bounds) {
    const [snapshot] = await db
      .select()
      .from(kpiSnapshots)
      .where(
        and(
          eq(kpiSnapshots.goalId, goal.id),
          eq(kpiSnapshots.viewerId, actor.id),
          eq(kpiSnapshots.periodStart, bounds.start),
          eq(kpiSnapshots.periodEnd, bounds.end),
        ),
      );
    if (snapshot) {
      // Stored figures are viewer-specific. Contributor links/labels are intentionally omitted:
      // permissions may have narrowed since capture, and historical IDs cannot bypass that.
      return {
        ...snapshot.result,
        scopeName,
        measurement: {
          ...snapshot.result.measurement,
          contributors: [],
          contributorsTruncated: true,
          issues: [...snapshot.result.measurement.issues, "frozen_viewer_snapshot"],
        },
      };
    }
  }
  const measurement = await evaluateKpi(
    db,
    actor,
    definition,
    goal,
    goal.period,
    on,
    signal,
    goal.id,
    clock,
  );
  return {
    goal,
    scopeName,
    definition,
    measurement,
    assessment: assessKpi(goal.condition, measurement, goal.pacing, on),
  };
}

export async function readKpiWorkspace(
  db: Db,
  actor: PermSetUser,
  on: string,
  signal: AbortSignal,
): Promise<KpiWorkspace> {
  signal.throwIfAborted();
  const preferences = await getPreferencesForActor(db, actor.id);
  const now = new Date();
  const clock = {
    day: todayInZone(preferences.timezone, now),
    instant: now.toISOString(),
    timeZone: preferences.timezone,
  };
  const rows = await db
    .select()
    .from(kpiGoals)
    .where(isNull(kpiGoals.archivedAt))
    .orderBy(desc(kpiGoals.createdAt));
  const visible: KpiGoal[] = [];
  for (const row of rows)
    if (await kpiScopeVisible(db, actor, row.assignment)) visible.push(goalDto(row));
  const scopeNames = await visibleScopeNames(db, visible);
  const goals: KpiGoalResult[] = [];
  for (const goal of visible) {
    signal.throwIfAborted();
    goals.push(await readKpiGoalResult(db, actor, goal, on, signal, clock, scopeNames));
  }
  const assignedSchemeIds = Array.from(
    new Set(visible.flatMap((goal) => (hasKpiId(goal.schemeId) ? [goal.schemeId] : []))),
  );
  // An assigned scorecard's label is visible context. Its unassigned entries and later
  // revisions remain outside this projection, including for viewers without goals.manage.
  const schemeLabels = assignedSchemeIds.length
    ? await db
        .select({
          id: kpiSchemes.id,
          name: sql<string>`${kpiSchemes.definition}->>'name'`,
          revision: kpiSchemes.revision,
        })
        .from(kpiSchemes)
        .where(inArray(kpiSchemes.id, assignedSchemeIds))
    : [];
  if (!can(actor, "goals.manage"))
    return {
      definitions: Array.from(new Map(goals.map((g) => [g.definition.id, g.definition])).values()),
      schemes: [],
      schemeLabels,
      goals,
    };
  const [defs, schemes] = await Promise.all([
    db.select().from(kpiDefinitions).orderBy(desc(kpiDefinitions.revision)),
    db.select().from(kpiSchemes).orderBy(desc(kpiSchemes.revision)),
  ]);
  const heads = new Map<string, KpiDefinition>();
  const schemeHeads = new Map<string, KpiScheme>();
  for (const row of defs) if (!heads.has(row.familyId)) heads.set(row.familyId, defDto(row));
  for (const row of schemes)
    if (!schemeHeads.has(row.familyId)) schemeHeads.set(row.familyId, schemeDto(row));
  const referencedIds = new Set([
    ...Array.from(schemeHeads.values()).flatMap((s) => s.entries.map((e) => e.definitionId)),
    ...goals.map((g) => g.definition.id),
  ]);
  return {
    definitions: Array.from(heads.values()),
    referencedDefinitions: defs.filter((d) => referencedIds.has(d.id)).map(defDto),
    schemes: Array.from(schemeHeads.values()),
    schemeLabels,
    goals,
  };
}
