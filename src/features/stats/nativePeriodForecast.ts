import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { currentNativeReadActor, type NativeSessionRef } from "@/features/auth/currentNativeActor";
import { currencyCode } from "@/features/currencies/currencySchema";
import { resolveAccountLocalePreferences } from "@/features/i18n/accountPreferences";
import type { LocalePreferenceFallback } from "@/features/i18n/localePreferenceCookies";
import { getPreferences } from "@/features/identity/preferencesRepo";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import type { OwnerScope } from "@/types/stats";
import {
  type ForecastGoalCoverage,
  type ForecastGoalOptions,
  readForecastGoalCoverageInSnapshot,
  readForecastGoalOptionsInSnapshot,
} from "./forecastGoalCoverage";
import {
  readCapturedOpenForecastRoster,
  readCurrentInventoryObservation,
} from "./history/inventorySnapshotRepository";
import { type HistoryInstallation, readHistoryInstallation } from "./history/repository";
import { restrictReportActor } from "./hydrateReportActor";
import { resolveOwnerIds } from "./ownerIds";
import {
  calculatePeriodForecast,
  type ForecastScenarioAssumptions,
  type ForecastTarget,
  MAX_PERIOD_FORECAST_DEALS,
  type PeriodForecastResult,
  periodForecastProbability,
  periodForecastSizeMultiplier,
} from "./periodForecast";
import { reportPeriod } from "./reportPeriod";
import { ownerScopeInput } from "./schemas";
import { isPipelineVisible } from "./visiblePipelines";

export const NATIVE_FORECAST_SCENARIO_POLICY_VERSION = 1;
const MAX_TARGET_DAYS = 366;
const DAY_MS = 86_400_000;
const civilDate = z.iso.date().refine((value) => !value.startsWith("0000-"));
const utcInstant = z.iso.datetime({ precision: 6 });

const manualScenario = z.strictObject({
  pWin: periodForecastProbability.nullable(),
  pCloseInPeriodGivenWin: periodForecastProbability.nullable(),
  sizeMultiplier: periodForecastSizeMultiplier.optional(),
});

export const nativeForecastGoalOptionsInput = z
  .strictObject({
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .pipe(currencyCode),
    pipelineId: z
      .guid()
      .transform((value) => value.toLowerCase())
      .nullable(),
    ownerScope: ownerScopeInput,
    from: civilDate,
    to: civilDate,
  })
  .refine(
    ({ from, to }) => {
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
      return days >= 0 && days < MAX_TARGET_DAYS;
    },
    { path: ["to"], message: "The target must cover at most 366 inclusive civil days" },
  );

export const nativePeriodForecastInput = nativeForecastGoalOptionsInput.safeExtend({
  policyVersion: z.literal(NATIVE_FORECAST_SCENARIO_POLICY_VERSION),
  goalId: z.uuid().optional(),
  scenarios: z.strictObject({
    conservative: manualScenario,
    base: manualScenario,
    upside: manualScenario,
  }),
});

type ScopeRequest = z.output<typeof nativeForecastGoalOptionsInput>;
type Request = z.output<typeof nativePeriodForecastInput>;
type KernelReport = Extract<PeriodForecastResult, { ok: true }>;
type KernelScenario = KernelReport["scenarios"]["base"];
type ScenarioSummary = Omit<KernelScenario, "contributors">;
type CaptureFailure = Exclude<HistoryInstallation, { state: "installed" }>["reason"];

interface ServerPrincipal {
  actor: PermSetUser;
  session: NativeSessionRef;
}

export type NativePeriodForecastRequest = z.input<typeof nativePeriodForecastInput>;
export type NativePeriodForecast =
  | {
      state: "unavailable";
      reason:
        | CaptureFailure
        | "invalid-input"
        | "permission"
        | "scope-unavailable"
        | "target-unavailable"
        | "target-not-future"
        | "roster-limit"
        | "roster-unqualified"
        | "source-unavailable";
    }
  | {
      state: "available";
      basis: "explicit-manual-what-if";
      rosterBasis: "captured-current-open-deals";
      policyVersion: typeof NATIVE_FORECAST_SCENARIO_POLICY_VERSION;
      calculationVersion: KernelReport["definitionVersion"];
      currency: string;
      cutoffObservedAt: string;
      target: ForecastTarget;
      targetDates: { from: string; to: string };
      scope: { pipeline: "selected" | "all-visible"; owner: OwnerScope["kind"] };
      assumptions: Request["scenarios"];
      openDealCount: number;
      recordedOpenValue: KernelReport["recordedOpenValue"];
      scenarios: Record<keyof KernelReport["scenarios"], ScenarioSummary>;
      goalCoverage?: ForecastGoalCoverage;
    };
type AvailableForecast = Extract<NativePeriodForecast, { state: "available" }>;

function unavailable(
  reason: Extract<NativePeriodForecast, { state: "unavailable" }>["reason"],
): NativePeriodForecast {
  return { state: "unavailable", reason };
}

async function ownerAvailable(
  tx: Db,
  actor: PermSetUser,
  scope: OwnerScope,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  if (scope.kind === "me" || (scope.kind === "user" && scope.userId === actor.id)) return true;
  if (!can(actor, "stats.viewOthers")) return false;
  if (scope.kind === "all") return true;
  if (scope.kind === "user") {
    const rows = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.id, scope.userId), eq(schema.users.isActive, true)))
      .limit(1);
    return rows.length === 1;
  }
  const rows = await tx
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(eq(schema.teams.id, scope.teamId))
    .limit(1);
  return rows.length === 1;
}

const boundsSchema = z.strictObject({ from: utcInstant, toExclusive: utcInstant });

async function resolveTarget(
  tx: Db,
  actor: PermSetUser,
  request: ScopeRequest,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<ForecastTarget | null> {
  const preferences = await getPreferences(tx, actor.id, signal);
  const { timeZone, calendar } = resolveAccountLocalePreferences({
    saved: preferences.ui.localePreferences,
    profileTimeZone: preferences.timezone,
    fallback: localeFallback,
  });
  signal.throwIfAborted();
  const period = reportPeriod({ from: request.from, to: request.to, timeZone });
  const { rows } = await tx.execute(sql`
    WITH bounds AS MATERIALIZED (
      SELECT ${period.from} AS starts_at, ${period.toExclusive} AS ends_at
    )
    SELECT pg_catalog.to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "from",
      pg_catalog.to_char(ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "toExclusive"
    FROM bounds
    WHERE starts_at < ends_at
      AND (starts_at AT TIME ZONE ${timeZone}::text)::date = ${request.from}::date
      AND (ends_at AT TIME ZONE ${timeZone}::text)::date = (${request.to}::date + 1)
  `);
  signal.throwIfAborted();
  const parsed = boundsSchema.safeParse(rows[0]);
  return parsed.success ? { ...parsed.data, timeZone, calendar } : null;
}

function scenarioWithEvidence(
  input: z.output<typeof manualScenario>,
  target: ForecastTarget,
  observedAt: string,
): ForecastScenarioAssumptions {
  const evidence = {
    kind: "manual",
    sourceId: "current-period-forecast-what-if",
    version: String(NATIVE_FORECAST_SCENARIO_POLICY_VERSION),
    observedAt,
  } as const;
  return {
    pWin: input.pWin === null ? null : { probability: input.pWin, evidence },
    pCloseInPeriodGivenWin:
      input.pCloseInPeriodGivenWin === null
        ? null
        : { probability: input.pCloseInPeriodGivenWin, target, evidence },
    ...(input.sizeMultiplier === undefined
      ? {}
      : { sizeMultiplier: { multiplier: input.sizeMultiplier, evidence } }),
  };
}

function summarizeScenario(scenario: KernelScenario): ScenarioSummary {
  return {
    expectedWonCount: scenario.expectedWonCount,
    expectedWonValue: scenario.expectedWonValue,
    missingWinProbabilityCount: scenario.missingWinProbabilityCount,
    missingTimingProbabilityCount: scenario.missingTimingProbabilityCount,
  };
}

function forecastScope(input: ScopeRequest): AvailableForecast["scope"] {
  return {
    pipeline: input.pipelineId === null ? "all-visible" : "selected",
    owner: input.ownerScope.kind,
  };
}

function summarize(result: KernelReport, input: Request): AvailableForecast {
  const { conservative, base, upside } = result.scenarios;
  return {
    state: "available",
    basis: "explicit-manual-what-if",
    rosterBasis: "captured-current-open-deals",
    policyVersion: NATIVE_FORECAST_SCENARIO_POLICY_VERSION,
    calculationVersion: result.definitionVersion,
    currency: result.currency,
    cutoffObservedAt: result.cutoffObservedAt,
    target: result.target,
    targetDates: { from: input.from, to: input.to },
    scope: forecastScope(input),
    assumptions: input.scenarios,
    openDealCount: result.openDealCount,
    recordedOpenValue: result.recordedOpenValue,
    scenarios: {
      conservative: summarizeScenario(conservative),
      base: summarizeScenario(base),
      upside: summarizeScenario(upside),
    },
  };
}

async function resolveForecastSource(
  tx: Db,
  actor: PermSetUser,
  input: Request,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
) {
  if (!(await ownerAvailable(tx, actor, input.ownerScope, signal)))
    return { ok: false as const, result: unavailable("scope-unavailable") };
  if (input.pipelineId !== null && !(await isPipelineVisible(tx, actor, input.pipelineId, signal)))
    return { ok: false as const, result: unavailable("scope-unavailable") };
  const owners = await resolveOwnerIds(
    tx,
    actor,
    input.ownerScope,
    signal,
    MAX_PERIOD_FORECAST_DEALS + 1,
  );
  if (!owners.everyone && owners.ids.length > MAX_PERIOD_FORECAST_DEALS)
    return { ok: false as const, result: unavailable("roster-limit") };

  const target = await resolveTarget(tx, actor, input, signal, localeFallback);
  if (target === null) return { ok: false as const, result: unavailable("target-unavailable") };
  const installation = await readHistoryInstallation(tx, signal);
  if (installation.state !== "installed")
    return { ok: false as const, result: unavailable(installation.reason) };
  return { ok: true as const, owners, target, activation: installation.activation };
}

function rosterFailure(
  reason: Extract<
    Awaited<ReturnType<typeof readCapturedOpenForecastRoster>>,
    { state: "unavailable" }
  >["reason"],
): NativePeriodForecast {
  if (reason === "snapshot-fact-limit") return unavailable("roster-limit");
  if (reason === "snapshot-capture-incomplete" || reason === "source-writes-pending")
    return unavailable("roster-unqualified");
  return unavailable("source-unavailable");
}

async function configureNativeForecastRead(tx: Db): Promise<void> {
  await tx.execute(sql`SET LOCAL search_path = pg_catalog, public, pg_temp`);
  await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
  await tx.execute(sql`SET LOCAL lock_timeout = '2000ms'`);
}

async function readInSnapshot(
  tx: Db,
  principal: ServerPrincipal,
  input: Request,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<NativePeriodForecast> {
  await configureNativeForecastRead(tx);
  const observation = await readCurrentInventoryObservation(tx, signal);
  if (observation === null) return unavailable("source-unavailable");
  const live = await currentNativeReadActor(tx, principal.session, signal);
  const actor = restrictReportActor(principal.actor, live?.actor ?? null);
  if (actor === null) return unavailable("permission");
  const source = await resolveForecastSource(tx, actor, input, signal, localeFallback);
  if (!source.ok) return source.result;
  const { target, activation, owners } = source;
  if (observation.observedAt >= target.from) return unavailable("target-not-future");
  if (activation.activatedAt > observation.observedAt) return unavailable("roster-unqualified");

  const roster = await readCapturedOpenForecastRoster(
    tx,
    actor,
    { pipelineId: input.pipelineId, ownerScope: input.ownerScope, owners },
    input.currency,
    activation.activationId,
    observation,
    signal,
  );
  if (roster.state === "unavailable") return rosterFailure(roster.reason);
  const assumptions = {
    conservative: scenarioWithEvidence(
      input.scenarios.conservative,
      target,
      observation.observedAt,
    ),
    base: scenarioWithEvidence(input.scenarios.base, target, observation.observedAt),
    upside: scenarioWithEvidence(input.scenarios.upside, target, observation.observedAt),
  };
  const result = calculatePeriodForecast({
    currency: input.currency,
    target,
    cutoffObservedAt: observation.observedAt,
    deals: roster.records.map((row) => ({
      dealId: row.entityId,
      incarnationId: row.incarnationId,
      status: row.status,
      currency: row.currency,
      value: row.value,
      expectedCloseDate: row.expectedCloseDate,
      scenarios: assumptions,
    })),
  });
  signal.throwIfAborted();
  if (!result.ok) return unavailable("roster-unqualified");
  const forecast = summarize(result, input);
  const goalCoverage =
    input.goalId === undefined
      ? undefined
      : await readForecastGoalCoverageInSnapshot(
          tx,
          actor,
          {
            forecast,
            viewerId: actor.id,
            pipelineId: input.pipelineId,
            ownerScope: input.ownerScope,
            transactionSnapshot: observation.transactionSnapshot,
          },
          input.goalId,
          signal,
        );
  if ((await currentNativeReadActor(tx, principal.session, signal)) === null)
    return unavailable("permission");
  return goalCoverage === undefined ? forecast : { ...forecast, goalCoverage };
}

async function readOnFreshClient<T>(
  pool: Pool,
  signal: AbortSignal,
  fallback: T,
  read: (tx: Db) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let reusable = false;
  try {
    signal.throwIfAborted();
    if (client.getTransactionStatus() !== "I") return fallback;
    const bound = drizzle(client, { schema });
    const result = await bound.transaction(read, {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
    reusable = client.getTransactionStatus() === "I";
    signal.throwIfAborted();
    return reusable ? result : fallback;
  } finally {
    client.release(!reusable);
  }
}

/**
 * One private current observation of explicitly scoped, captured CRM open deals.
 * Manual scenario factors are hypotheses applied uniformly, never learned from CRM.
 * This reader neither persists forecasts nor exposes internal roster identities.
 */
export async function readNativePeriodForecast(
  db: Db,
  principal: ServerPrincipal,
  input: NativePeriodForecastRequest,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<NativePeriodForecast> {
  signal.throwIfAborted();
  if (!principal.actor.isActive || principal.actor.id !== principal.session.userId)
    return unavailable("permission");
  const parsed = nativePeriodForecastInput.safeParse(input);
  if (!parsed.success) return unavailable("invalid-input");
  if (!("$client" in db) || !(db.$client instanceof Pool)) return unavailable("source-unavailable");
  try {
    return await readOnFreshClient(db.$client, signal, unavailable("source-unavailable"), (tx) =>
      readInSnapshot(tx, principal, parsed.data, signal, localeFallback),
    );
  } catch {
    signal.throwIfAborted();
    return unavailable("source-unavailable");
  }
}

async function readOptionsInSnapshot(
  tx: Db,
  principal: ServerPrincipal,
  input: ScopeRequest,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<ForecastGoalOptions> {
  await configureNativeForecastRead(tx);
  const observation = await readCurrentInventoryObservation(tx, signal);
  if (observation === null) return { state: "unavailable" };
  const current = await currentNativeReadActor(tx, principal.session, signal);
  const actor = restrictReportActor(principal.actor, current?.actor ?? null);
  if (actor === null || !(await ownerAvailable(tx, actor, input.ownerScope, signal)))
    return { state: "unavailable" };
  if (input.pipelineId !== null && !(await isPipelineVisible(tx, actor, input.pipelineId, signal)))
    return { state: "unavailable" };
  const target = await resolveTarget(tx, actor, input, signal, localeFallback);
  if (target === null || observation.observedAt >= target.from) return { state: "unavailable" };
  const options = await readForecastGoalOptionsInSnapshot(
    tx,
    actor,
    {
      forecast: {
        currency: input.currency,
        cutoffObservedAt: observation.observedAt,
        target,
        targetDates: { from: input.from, to: input.to },
        scope: forecastScope(input),
      },
      viewerId: actor.id,
      pipelineId: input.pipelineId,
      ownerScope: input.ownerScope,
    },
    signal,
  );
  return (await currentNativeReadActor(tx, principal.session, signal)) === null
    ? { state: "unavailable" }
    : options;
}

export async function readNativeForecastGoalOptions(
  db: Db,
  principal: ServerPrincipal,
  input: z.input<typeof nativeForecastGoalOptionsInput>,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<ForecastGoalOptions> {
  signal.throwIfAborted();
  if (!principal.actor.isActive || principal.actor.id !== principal.session.userId)
    return { state: "unavailable" };
  const parsed = nativeForecastGoalOptionsInput.safeParse(input);
  if (!parsed.success || !("$client" in db) || !(db.$client instanceof Pool))
    return { state: "unavailable" };
  try {
    return await readOnFreshClient<ForecastGoalOptions>(
      db.$client,
      signal,
      { state: "unavailable" },
      (tx) => readOptionsInSnapshot(tx, principal, parsed.data, signal, localeFallback),
    );
  } catch {
    signal.throwIfAborted();
    return { state: "unavailable" };
  }
}
