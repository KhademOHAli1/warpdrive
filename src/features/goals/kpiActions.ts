"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { kpiGoals, kpiMeasurements, kpiSchemes, kpiSnapshots } from "@/db/schema/kpis";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { getPreferencesForActor } from "@/features/identity/preferencesForActor";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";
import { kpiPeriodBounds } from "./kpiEngine";
import type {
  KpiActionResult,
  KpiDefinition,
  KpiGoal,
  KpiMeasurement,
  KpiPeriod,
  KpiScheme,
  KpiScope,
  KpiWorkspace,
} from "./kpiModel";
import {
  assignKpiGoal,
  evaluateKpi,
  getKpiDefinition,
  getKpiGoal,
  KpiError,
  kpiScopeExists,
  kpiScopeVisible,
  readKpiGoalResult,
  readKpiWorkspace,
  saveKpiDefinition,
  saveKpiScheme,
} from "./kpiRepo";
import {
  kpiConditionInput,
  kpiDefinitionInput,
  kpiGoalInput,
  kpiManualInput,
  kpiPeriodInput,
  kpiRevisionInput,
  kpiSchemeInput,
  kpiScopeInput,
} from "./kpiSchemas";
import { todayInZone } from "./todayInZone";

async function guard(csrf: string | null, manage = true) {
  if (manage && !(await guardCsrf(csrf)).ok) throw new KpiError("E_AUTH_CSRF");
  const context = await createContext();
  if (!context.actor) throw new KpiError("E_AUTH_SESSION_DEAD");
  if (!context.actor.isActive || (manage && !can(context.actor, "goals.manage")))
    throw new KpiError("E_PERM_DENIED");
  return { ...context, actor: context.actor };
}
function errorId(error: unknown): string {
  if (error instanceof KpiError) return error.id;
  if (error instanceof z.ZodError) return "E_KPI_INVALID";
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 5 && current !== null && current !== undefined && typeof current === "object";
    depth++
  ) {
    const cause = current as { code?: string; cause?: unknown };
    if (cause.code === "42P01" || cause.code === "42703") return "E_KPI_NOT_READY";
    if (cause.code === "23505") return "E_KPI_CONFLICT";
    current = cause.cause;
  }
  return "E_KPI_FAILED";
}
async function result<T>(run: () => Promise<T>): Promise<KpiActionResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: { id: errorId(error) } };
  }
}
export async function readKpiWorkspaceAction(on: string): Promise<KpiActionResult<KpiWorkspace>> {
  return result(async () => {
    const { db, actor } = await guard(null, false);
    return readKpiWorkspace(db, actor, z.string().date().parse(on), SIG());
  });
}
export async function saveKpiDefinitionAction(
  raw: unknown,
  csrfToken: string | null = null,
): Promise<KpiActionResult<KpiDefinition>> {
  return result(async () => {
    const { db, actor } = await guard(csrfToken);
    return saveKpiDefinition(db, actor, kpiDefinitionInput.parse(raw), kpiRevisionInput.parse(raw));
  });
}
export async function saveKpiSchemeAction(
  raw: unknown,
  csrfToken: string | null = null,
): Promise<KpiActionResult<KpiScheme>> {
  return result(async () => {
    const { db, actor } = await guard(csrfToken);
    return saveKpiScheme(db, actor, kpiSchemeInput.parse(raw), kpiRevisionInput.parse(raw));
  });
}
export async function createKpiPackAction(
  raw: unknown,
  csrfToken: string | null = null,
): Promise<KpiActionResult<KpiScheme>> {
  return result(async () => {
    const { db, actor } = await guard(csrfToken);
    const input = z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(1200),
        entries: z
          .array(z.object({ definition: kpiDefinitionInput, condition: kpiConditionInput }))
          .min(1)
          .max(30),
      })
      .parse(raw);
    return db.transaction(async (tx) => {
      const entries: { definitionId: string; condition: z.infer<typeof kpiConditionInput> }[] = [];
      for (const entry of input.entries) {
        const definition = await saveKpiDefinition(tx, actor, entry.definition, {});
        entries.push({ definitionId: definition.id, condition: entry.condition });
      }
      return saveKpiScheme(
        tx,
        actor,
        { name: input.name, description: input.description, entries },
        {},
      );
    });
  });
}
export async function assignKpiGoalAction(
  raw: unknown,
  csrfToken: string | null = null,
): Promise<KpiActionResult<KpiGoal>> {
  return result(async () => {
    const { db, actor } = await guard(csrfToken);
    return assignKpiGoal(db, actor, kpiGoalInput.parse(raw));
  });
}
export async function createKpiGoalAction(
  raw: unknown,
  csrfToken: string | null = null,
): Promise<KpiActionResult<{ definition: KpiDefinition; goal: KpiGoal }>> {
  return result(async () => {
    const { db, actor } = await guard(csrfToken);
    const input = z.object({ definition: kpiDefinitionInput, assignment: z.unknown() }).parse(raw);
    const candidate = kpiGoalInput.parse({
      ...z.object({}).passthrough().parse(input.assignment),
      definitionId: crypto.randomUUID(),
    });
    return db.transaction(async (tx) => {
      const definition = await saveKpiDefinition(tx, actor, input.definition, {});
      const goal = await assignKpiGoal(tx, actor, { ...candidate, definitionId: definition.id });
      return { definition, goal };
    });
  });
}
export async function previewKpiAction(
  rawDefinition: unknown,
  rawScope: KpiScope,
  rawPeriod: KpiPeriod,
  csrfToken: string | null = null,
): Promise<KpiActionResult<KpiMeasurement>> {
  return result(async () => {
    const { db, actor } = await guard(csrfToken);
    const scope = kpiScopeInput.parse(rawScope);
    if (!(await kpiScopeExists(db, scope))) throw new KpiError("E_KPI_INVALID");
    const preferences = await getPreferencesForActor(db, actor.id);
    const on = todayInZone(preferences.timezone, new Date());
    const period = kpiPeriodInput.parse(rawPeriod);
    // Preview the first relevant period for a future start; preserve the actual clock for overdue tests.
    return evaluateKpi(
      db,
      actor,
      kpiDefinitionInput.parse(rawDefinition),
      scope,
      period,
      // biome-ignore lint/complexity/useMathMinMax: ISO dates compare lexically, not numerically.
      on < period.startsOn ? period.startsOn : on,
      SIG(),
      undefined,
      { day: on, instant: new Date().toISOString(), timeZone: preferences.timezone },
    );
  });
}
export async function applyKpiSchemeAction(
  raw: unknown,
  csrfToken: string | null = null,
): Promise<KpiActionResult<KpiGoal[]>> {
  return result(async () => {
    const { db, actor } = await guard(csrfToken);
    const input = kpiScopeInput
      .safeExtend({
        schemeId: z.string().uuid(),
        period: kpiPeriodInput,
        pacing: z.enum(["linear", "none"]),
      })
      .parse(raw);
    return db.transaction(async (tx) => {
      const [scheme] = await tx.select().from(kpiSchemes).where(eq(kpiSchemes.id, input.schemeId));
      if (!scheme) throw new KpiError("E_KPI_NOT_FOUND");
      const assigned: KpiGoal[] = [];
      for (const entry of scheme.definition.entries) {
        const definition = await getKpiDefinition(tx, entry.definitionId);
        const linear =
          definition.graph === undefined &&
          input.pacing === "linear" &&
          ["count", "distinct_count", "sum"].includes(definition.calculation) &&
          entry.condition.kind === "at_least" &&
          Number(entry.condition.target) > 0 &&
          input.period.kind !== "rolling";
        const assignment = kpiGoalInput.parse({
          definitionId: entry.definitionId,
          schemeId: scheme.id,
          scope: input.scope,
          scopeId: input.scopeId,
          condition: entry.condition,
          period: input.period,
          pacing: linear ? "linear" : "none",
        });
        assigned.push(await assignKpiGoal(tx, actor, assignment));
      }
      return assigned;
    });
  });
}
export async function archiveKpiGoalAction(
  id: string,
  csrfToken: string | null = null,
): Promise<KpiActionResult<{ id: string }>> {
  return result(async () => {
    const { db } = await guard(csrfToken);
    const parsed = z.string().uuid().parse(id);
    const rows = await db
      .update(kpiGoals)
      .set({ archivedAt: new Date() })
      .where(and(eq(kpiGoals.id, parsed), isNull(kpiGoals.archivedAt)))
      .returning({ id: kpiGoals.id });
    if (!rows[0]) throw new KpiError("E_KPI_NOT_FOUND");
    return rows[0];
  });
}
export async function recordKpiMeasurementAction(
  raw: unknown,
  csrfToken: string | null = null,
): Promise<KpiActionResult<{ id: string }>> {
  return result(async () => {
    const { db, actor } = await guard(csrfToken);
    const input = kpiManualInput.parse(raw);
    const goal = await getKpiGoal(db, input.goalId);
    const definition = await getKpiDefinition(db, goal.definitionId);
    if (definition.source !== "manual" || !(await kpiScopeVisible(db, actor, goal)))
      throw new KpiError("E_PERM_DENIED");
    const preferences = await getPreferencesForActor(db, actor.id);
    const today = todayInZone(preferences.timezone, new Date());
    if (input.measuredOn > today || !kpiPeriodBounds(goal.period, input.measuredOn))
      throw new KpiError("E_KPI_INVALID");
    if (["count", "hours", "days"].includes(definition.unit) && Number(input.value) < 0)
      throw new KpiError("E_KPI_INVALID");
    const [row] = await db
      .insert(kpiMeasurements)
      .values({ ...input, recordedBy: actor.id })
      .returning({ id: kpiMeasurements.id });
    if (!row) throw new KpiError("E_KPI_FAILED");
    return row;
  });
}
/** Explicit capture only. It preserves the caller's view, never a company-wide assertion. */
export async function closeKpiPeriodAction(
  raw: unknown,
  csrfToken: string | null = null,
): Promise<KpiActionResult<{ id: string }>> {
  return result(async () => {
    const { db, actor } = await guard(csrfToken);
    const input = z.object({ goalId: z.string().uuid(), on: z.string().date() }).parse(raw);
    const goal = await getKpiGoal(db, input.goalId);
    const bounds = kpiPeriodBounds(goal.period, input.on);
    const preferences = await getPreferencesForActor(db, actor.id);
    const today = todayInZone(preferences.timezone, new Date());
    if (!bounds || goal.period.kind === "rolling" || bounds.end >= today)
      throw new KpiError("E_KPI_INVALID");
    const snapshot = await readKpiGoalResult(db, actor, goal, bounds.end, SIG());
    if (snapshot.measurement.state !== "available") throw new KpiError("E_KPI_INVALID");
    // A manual observation's sharing boundary is its immutable assignment. CRM observations
    // remain live because record permission changes cannot safely authorize frozen aggregates.
    if (snapshot.definition.source !== "manual")
      throw new KpiError("E_KPI_SNAPSHOT_REQUIRES_MANUAL");
    const [row] = await db
      .insert(kpiSnapshots)
      .values({
        goalId: goal.id,
        viewerId: actor.id,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        result: snapshot,
      })
      .returning({ id: kpiSnapshots.id });
    if (!row) throw new KpiError("E_KPI_FAILED");
    return row;
  });
}
