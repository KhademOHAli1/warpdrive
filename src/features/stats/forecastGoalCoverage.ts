import { and, desc, eq, is, isNull, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "@/db/client";
import { kpiDefinitions, kpiGoals } from "@/db/schema/kpis";
import { kpiPeriodBounds } from "@/features/goals/kpiEngine";
import type { KpiDefinition, KpiGoal, KpiGoalResult, KpiScope } from "@/features/goals/kpiModel";
import {
  getKpiDefinition,
  getKpiGoal,
  kpiScopeVisible,
  readKpiGoalResult,
} from "@/features/goals/kpiRepo";
import { kpiDefinitionInput, kpiGoalInput } from "@/features/goals/kpiSchemas";
import { todayInZone } from "@/features/goals/todayInZone";
import { isTimeZone } from "@/features/i18n/preferences";
import { getPreferences } from "@/features/identity/preferencesRepo";
import type { PermSetUser } from "@/features/permissions/effective";
import type { OwnerScope } from "@/types/stats";
import type { NativePeriodForecast } from "./nativePeriodForecast";

type Forecast = Extract<NativePeriodForecast, { state: "available" }>;

/** Private selectors and cut supplied by the native forecast's authenticated transaction. */
interface ForecastGoalScope {
  readonly forecast: Pick<
    Forecast,
    "currency" | "cutoffObservedAt" | "target" | "targetDates" | "scope"
  >;
  readonly viewerId: string;
  readonly pipelineId: string | null;
  readonly ownerScope: OwnerScope;
}

export interface ForecastGoalContext extends ForecastGoalScope {
  readonly forecast: Forecast;
  readonly transactionSnapshot: string;
}

export type ForecastGoalOptions =
  | { state: "available"; options: { id: string; label: string }[] }
  | { state: "unavailable" | "limit" };

const MAX_GOAL_CANDIDATES = 100;
type ScenarioCoverage =
  | { state: "unavailable"; reason: "incomplete-forecast" }
  | { state: "available"; numerator: string; denominator: string; remainingAfterScenario: string };

export type ForecastGoalCoverage =
  | {
      state: "unavailable";
      reason: "target-unavailable" | "scope-mismatch" | "period-mismatch" | "booked-unavailable";
    }
  | {
      state: "available";
      source: "current-pinned-won-value-kpi-v1";
      currency: string;
      bookedNominalValue: string;
      targetNominalValue: string;
      remainingNominalValue: string;
      coverage:
        | { state: "unavailable"; reason: "no-positive-remaining-target" }
        | { state: "available"; scenarios: Record<keyof Forecast["scenarios"], ScenarioCoverage> };
    };

const goalSelector = z.uuid().transform((id) => id.toLowerCase());
const instant = z.iso.datetime({ precision: 6 });
const money = /^-?\d{1,20}(?:\.\d{1,4})?$/u;
const scenarioMoney = /^-?\d{1,20}(?:\.\d{1,22})?$/u;
// Forecast v1 multiplies a four-place amount by up to three six-place factors.
const VALUE_PLACES = 22;

function unavailable(
  reason: Extract<ForecastGoalCoverage, { state: "unavailable" }>["reason"],
): ForecastGoalCoverage {
  return { state: "unavailable", reason };
}

function exactUnits(decimal: string): bigint {
  const [whole = "0", fraction = ""] = decimal.split(".");
  return BigInt(whole + fraction.padEnd(VALUE_PLACES, "0"));
}

function exactText(units: bigint): string {
  const digits = units.toString().padStart(VALUE_PLACES + 1, "0");
  const whole = digits.slice(0, -VALUE_PLACES);
  const fraction = digits.slice(-VALUE_PLACES).replace(/0+$/u, "").padEnd(2, "0");
  return `${whole}.${fraction}`;
}

function kpiOwnerScope(context: ForecastGoalScope): KpiScope {
  const { ownerScope, viewerId } = context;
  switch (ownerScope.kind) {
    case "all":
      return { scope: "company", scopeId: null };
    case "me":
      return { scope: "user", scopeId: viewerId };
    case "user":
      return { scope: "user", scopeId: ownerScope.userId.toLowerCase() };
    case "team":
      return { scope: "team", scopeId: ownerScope.teamId.toLowerCase() };
  }
}

function isWonValueDefinition(definition: KpiDefinition): boolean {
  return (
    kpiDefinitionInput.safeParse(definition).success &&
    definition.graph === undefined &&
    definition.source === "deals" &&
    definition.calculation === "sum" &&
    definition.unit === "money" &&
    definition.dateField === "closed" &&
    definition.filters.status === "won" &&
    definition.filters.activityTypeId == null &&
    (definition.valueField === "value" || definition.valueField === undefined)
  );
}

function matchesPeriod(context: ForecastGoalScope, goal: KpiGoal): boolean {
  if (goal.period.kind === "rolling") return false;
  const { target, targetDates, cutoffObservedAt } = context.forecast;
  const period = kpiPeriodBounds(goal.period, targetDates.from);
  return (
    period !== null &&
    period.start === targetDates.from &&
    period.end === targetDates.to &&
    instant.safeParse(cutoffObservedAt).success &&
    instant.safeParse(target.from).success &&
    instant.safeParse(target.toExclusive).success &&
    cutoffObservedAt < target.from &&
    target.from < target.toExclusive
  );
}

function incompatibility(
  context: ForecastGoalScope,
  goal: KpiGoal,
  definition: KpiDefinition,
): "target-unavailable" | "scope-mismatch" | "period-mismatch" | null {
  const { forecast, pipelineId, ownerScope } = context;
  const expectedOwner = kpiOwnerScope(context);
  if (
    !kpiGoalInput.safeParse(goal).success ||
    goal.definitionId !== definition.id ||
    !isWonValueDefinition(definition) ||
    goal.condition.kind !== "at_least" ||
    !money.test(goal.condition.target)
  )
    return "target-unavailable";
  if (
    forecast.scope.pipeline !== (pipelineId === null ? "all-visible" : "selected") ||
    forecast.scope.owner !== ownerScope.kind ||
    definition.currency !== forecast.currency ||
    (definition.filters.pipelineId?.toLowerCase() ?? null) !== pipelineId ||
    goal.scope !== expectedOwner.scope ||
    (goal.scopeId?.toLowerCase() ?? null) !== expectedOwner.scopeId
  )
    return "scope-mismatch";
  return matchesPeriod(context, goal) ? null : "period-mismatch";
}

function bookedIsKnownEmpty(
  context: ForecastGoalContext,
  measurement: KpiGoalResult["measurement"],
) {
  const { targetDates } = context.forecast;
  return (
    measurement.state === "available" &&
    measurement.period?.start === targetDates.from &&
    measurement.period.end === targetDates.to &&
    measurement.recordCount === 0 &&
    measurement.missingMeasurementDateCount === 0 &&
    !measurement.issues.includes("frozen_viewer_snapshot") &&
    !measurement.issues.includes("record_limit") &&
    !measurement.issues.includes("missing_values") &&
    measurement.value !== null &&
    money.test(measurement.value) &&
    exactUnits(measurement.value) === 0n
  );
}

function scenarioCoverage(
  forecast: Forecast,
  scenario: keyof Forecast["scenarios"],
  remaining: bigint,
  denominator: string,
): ScenarioCoverage {
  const { knownTotal, knownDealCount, missingDealCount } =
    forecast.scenarios[scenario].expectedWonValue;
  if (
    knownTotal === null ||
    !scenarioMoney.test(knownTotal) ||
    knownDealCount !== forecast.openDealCount ||
    missingDealCount !== 0
  )
    return { state: "unavailable", reason: "incomplete-forecast" };
  const difference = remaining - exactUnits(knownTotal);
  return {
    state: "available",
    numerator: knownTotal,
    denominator,
    remainingAfterScenario: exactText(difference > 0n ? difference : 0n),
  };
}

/** Projects a current owner-produced KPI read from the native forecast's own cut. */
export function projectForecastGoalCoverage(
  context: ForecastGoalContext,
  result: KpiGoalResult,
): ForecastGoalCoverage {
  const rejected = incompatibility(context, result.goal, result.definition);
  if (rejected !== null) return unavailable(rejected);
  if (!bookedIsKnownEmpty(context, result.measurement)) return unavailable("booked-unavailable");

  const { forecast } = context;
  const target = result.goal.condition.target;
  const targetUnits = exactUnits(target);
  const remaining = targetUnits > 0n ? targetUnits : 0n;
  const denominator = exactText(remaining);
  return {
    state: "available",
    source: "current-pinned-won-value-kpi-v1",
    currency: forecast.currency,
    bookedNominalValue: "0.00",
    targetNominalValue: target,
    remainingNominalValue: denominator,
    coverage:
      remaining === 0n
        ? { state: "unavailable", reason: "no-positive-remaining-target" }
        : {
            state: "available",
            scenarios: {
              conservative: scenarioCoverage(forecast, "conservative", remaining, denominator),
              base: scenarioCoverage(forecast, "base", remaining, denominator),
              upside: scenarioCoverage(forecast, "upside", remaining, denominator),
            },
          },
  };
}

async function matchesNativeCut(tx: Db, context: ForecastGoalContext): Promise<boolean> {
  const result = await tx.execute<{ matched: boolean }>(sql`
    SELECT pg_catalog.pg_current_snapshot()::text = ${context.transactionSnapshot}
      AND pg_catalog.current_setting('transaction_isolation') = 'repeatable read'
      AND pg_catalog.current_setting('transaction_read_only') = 'on'
      AND pg_catalog.pg_current_xact_id_if_assigned() IS NULL
      AND NOT pg_catalog.pg_is_in_recovery() AS matched
  `);
  return result.rows[0]?.matched === true;
}

async function matchingKpiZone(
  tx: Db,
  actor: PermSetUser,
  scope: ForecastGoalScope,
  signal: AbortSignal,
): Promise<string | null> {
  const preferences = await getPreferences(tx, actor.id, signal);
  const zone = preferences.timezone ?? "UTC";
  return isTimeZone(zone) && zone === scope.forecast.target.timeZone ? zone : null;
}

/** Scoped options for the authenticated native forecast reader. No KPI values or contributors. */
export async function readForecastGoalOptionsInSnapshot(
  tx: Db,
  actor: PermSetUser,
  context: ForecastGoalScope,
  signal: AbortSignal,
): Promise<ForecastGoalOptions> {
  signal.throwIfAborted();
  if (!actor.isActive || actor.id !== context.viewerId) return { state: "unavailable" };
  const owner = kpiOwnerScope(context);
  if (!(await kpiScopeVisible(tx, actor, owner))) return { state: "unavailable" };
  if ((await matchingKpiZone(tx, actor, context, signal)) === null) return { state: "unavailable" };
  const { assignment } = kpiGoals;
  const { definition } = kpiDefinitions;
  const { forecast, pipelineId } = context;
  const rows = await tx
    .select({
      goalId: kpiGoals.id,
      assignment,
      goalCreatedAt: kpiGoals.createdAt,
      definitionId: kpiDefinitions.id,
      familyId: kpiDefinitions.familyId,
      revision: kpiDefinitions.revision,
      definitionCreatedAt: kpiDefinitions.createdAt,
      definition,
    })
    .from(kpiGoals)
    .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, kpiGoals.definitionId))
    .where(
      and(
        isNull(kpiGoals.archivedAt),
        sql`${assignment}->>'scope' = ${owner.scope}
        AND coalesce(pg_catalog.lower(${assignment}->>'scopeId'), '') = ${owner.scopeId ?? ""}
        AND ${assignment}#>>'{condition,kind}' = 'at_least'
        AND ${assignment}#>>'{period,kind}' IN ('calendar', 'one_off')
        AND ${assignment}#>>'{period,startsOn}' <= ${forecast.targetDates.from}
        AND coalesce(${assignment}#>>'{period,endsOn}', ${forecast.targetDates.to}) >= ${forecast.targetDates.to}
        AND ${definition}->>'currency' = ${forecast.currency}
        AND ${definition}->>'source' = 'deals' AND ${definition}->>'calculation' = 'sum'
        AND ${definition}->>'unit' = 'money' AND ${definition}->>'dateField' = 'closed'
        AND ${definition}#>>'{filters,status}' = 'won' AND NOT (${definition} ? 'graph')
        AND coalesce(pg_catalog.lower(${definition}#>>'{filters,pipelineId}'), '') = ${pipelineId ?? ""}
        AND pg_catalog.octet_length(${assignment}::text) <= 8192
        AND pg_catalog.octet_length(${definition}::text) <= 8192`,
      ),
    )
    .orderBy(desc(kpiGoals.createdAt), desc(kpiGoals.id))
    .limit(MAX_GOAL_CANDIDATES + 1);
  signal.throwIfAborted();
  if (rows.length > MAX_GOAL_CANDIDATES) return { state: "limit" };
  const options: Extract<ForecastGoalOptions, { state: "available" }>["options"] = [];
  for (const row of rows) {
    const goal: KpiGoal = {
      ...row.assignment,
      id: row.goalId,
      definitionId: row.definitionId,
      createdAt: row.goalCreatedAt.toISOString(),
    };
    const pinned: KpiDefinition = {
      ...row.definition,
      id: row.definitionId,
      familyId: row.familyId,
      revision: row.revision,
      createdAt: row.definitionCreatedAt.toISOString(),
    };
    if (incompatibility(context, goal, pinned) === null)
      options.push({ id: goal.id, label: goal.name?.trim() || pinned.name.trim() });
  }
  return { state: "available", options };
}

/** Internal only. Call before returning the forecast and pass its actual tx, cut and selectors. */
export async function readForecastGoalCoverageInSnapshot(
  tx: Db,
  actor: PermSetUser,
  context: ForecastGoalContext,
  goalId: string | undefined,
  signal: AbortSignal,
): Promise<ForecastGoalCoverage> {
  signal.throwIfAborted();
  const parsed = goalSelector.safeParse(goalId);
  if (!parsed.success || !actor.isActive || actor.id !== context.viewerId || !is(tx, PgTransaction))
    return unavailable("target-unavailable");
  try {
    // A failed optional KPI read rolls back its savepoint and leaves the forecast cut usable.
    return await tx.transaction(async (readTx) => {
      if (!(await matchesNativeCut(readTx, context))) return unavailable("target-unavailable");
      signal.throwIfAborted();
      const goal = await getKpiGoal(readTx, parsed.data);
      if (!(await kpiScopeVisible(readTx, actor, goal))) return unavailable("target-unavailable");
      const definition = await getKpiDefinition(readTx, goal.definitionId);
      const rejected = incompatibility(context, goal, definition);
      if (rejected !== null) return unavailable(rejected);
      const { cutoffObservedAt, targetDates } = context.forecast;
      // KPI Workspace currently resolves its clock from the profile column. The
      // forecast can resolve a different browser-local zone. Keep the owning KPI
      // boundaries rather than retiming its measurement to make the dates fit.
      const kpiZone = await matchingKpiZone(readTx, actor, context, signal);
      if (kpiZone === null) return unavailable("period-mismatch");
      const result = await readKpiGoalResult(readTx, actor, goal, targetDates.from, signal, {
        day: todayInZone(kpiZone, new Date(cutoffObservedAt)),
        instant: cutoffObservedAt,
        timeZone: kpiZone,
      });
      signal.throwIfAborted();
      return projectForecastGoalCoverage(context, result);
    });
  } catch {
    signal.throwIfAborted();
    return unavailable("target-unavailable");
  }
}
