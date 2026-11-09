import { Temporal } from "@js-temporal/polyfill";
import { eq, type SQL, sql } from "drizzle-orm";
import { Pool } from "pg";
import { z } from "zod";
import type { Db } from "@/db/client";
import { teamMembers } from "@/db/schema";
import { startOfCalendarMonth } from "@/features/activities/calendarSystem";
import { currencyCode } from "@/features/currencies/currencySchema";
import { resolveAccountLocalePreferences } from "@/features/i18n/accountPreferences";
import type { LocalePreferenceFallback } from "@/features/i18n/localePreferenceCookies";
import type { LocalePreferences } from "@/features/i18n/preferences";
import { getPreferences } from "@/features/identity/preferencesRepo";
import type { PermSetUser } from "@/features/permissions/effective";
import { dealVisibilityPredicate } from "@/features/permissions/sql";
import { visibleDealPopulation } from "@/features/stats/dealPopulation";
import { onlyOwners, resolveOwnerIds } from "@/features/stats/ownerIds";
import { ownerScope } from "@/features/stats/ownerScope";
import { reportPeriod } from "@/features/stats/reportPeriod";
import { isPipelineVisible, visiblePipelinePredicate } from "@/features/stats/visiblePipelines";
import { hydrateActor } from "@/server/hydrateActor";
import type { OwnerScope } from "@/types/stats";
import {
  type AnalyticsHistoryEvent,
  analyticsHistoryEvent,
  type HistoryActivation,
  type HistoryState,
  historyUuid,
  historyVisibilitySnapshot,
} from "./contracts";
import {
  type CohortSubject,
  computeEqualAgeCohorts,
  type EqualAgeCohortResult,
  MAX_COHORT_SUBJECTS,
} from "./equalAgeCohorts";
import { foldTransactionHistory, sameHistoryState } from "./fold";
import { type HistoryInstallation, readHistoryInstallation } from "./repository";

const DEFINITION_ID = "current-authorized-observed-deal-win-v1";
export const MAX_DEAL_COHORT_SCOPE = Math.min(1_000, MAX_COHORT_SUBJECTS);
export const MAX_DEAL_COHORT_HISTORY_EVENTS = 5_000;
const MAX_HISTORY_PAYLOAD_BYTES = 8 * 1024 * 1024;

const requestSchema = z
  .strictObject({
    from: z.iso.date(),
    to: z.iso.date(),
    pipelineId: historyUuid.nullable(),
    ownerScope: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("me") }),
      z.strictObject({ kind: z.literal("all") }),
      z.strictObject({ kind: z.literal("user"), userId: historyUuid }),
      z.strictObject({ kind: z.literal("team"), teamId: historyUuid }),
    ]),
    currency: currencyCode.optional(),
    horizon: z.strictObject({
      id: z
        .string()
        .min(1)
        .max(256)
        .refine((value) => value === value.trim()),
      elapsedNanoseconds: z.string().regex(/^[1-9][0-9]{0,22}$/),
    }),
  })
  .refine(({ from, to }) => from <= to);

export type ObservedDealWinCohortRequest = z.input<typeof requestSchema>;
type LocaleScope = Pick<LocalePreferences, "calendar" | "timeZone">;
interface CoverageBounds {
  requested: { fromInclusive: string; toExclusive: string };
  activatedAt: string;
  observedAt: string;
}
interface CoveredInterval {
  fromInclusive: string;
  to: string;
  upperBound: "inclusive" | "exclusive";
}
interface Coverage extends CoverageBounds {
  state: "complete" | "partial";
  covered: CoveredInterval;
}
type CollectorResult = Extract<EqualAgeCohortResult, { state: "available" }>;

export type ObservedDealWinCohorts =
  | Exclude<HistoryInstallation, { state: "installed" }>
  | { state: "unavailable"; reason: "period-outside-capture"; coverage: CoverageBounds }
  | {
      state: "unavailable";
      reason:
        | "invalid-request"
        | "not-authorized"
        | "history-read-failed"
        | "history-permission-limited"
        | "history-invalid"
        | "scope-limit"
        | "history-limit";
    }
  | {
      state: "available";
      population: "current-authorized-live-deals";
      effectiveOwnerScope: OwnerScope["kind"];
      baseline: "excluded";
      bucketMembership: "entries-within-covered-interval";
      coverage: Coverage;
      // Cohort buckets may contain only part of their calendar month. Membership is
      // restricted to coverage.covered even when the requested interval is fully covered.
      result: CollectorResult;
    };

type Unavailable = Exclude<ObservedDealWinCohorts, { state: "available" }>;

interface SourceRow {
  scopeLimit: boolean;
  historyLimit: boolean;
  invalidOrigin: boolean;
  permissionGap: boolean;
  events: unknown[];
}

const utcText = (value: SQL) =>
  sql`to_char(${value} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const compareInstants = (left: string, right: string) => Temporal.Instant.compare(left, right);
const snapshotRow = z.object({
  snapshot: historyVisibilitySnapshot,
  cutoff: z.string().datetime({ offset: true }),
});

async function currentActor(tx: Db, request: PermSetUser, signal: AbortSignal) {
  if (!request.isActive) return null;
  const live = await hydrateActor(tx, request.id, signal);
  if (live === null || request.type === "admin") return live;
  // A new grant during request processing must not expand the authenticated scope.
  return {
    id: live.id,
    type: "regular",
    isActive: true,
    groupIds: new Set([...request.groupIds].filter((id) => live.groupIds.has(id))),
    managedUserIds: new Set(
      [...(request.managedUserIds ?? [])].filter((id) => live.managedUserIds?.has(id) === true),
    ),
    flags: new Set(
      [...request.flags].filter((flag) => live.type === "admin" || live.flags.has(flag)),
    ),
  } satisfies PermSetUser;
}

async function resolveCohortOwners(
  tx: Db,
  actor: PermSetUser,
  scope: OwnerScope,
  signal: AbortSignal,
) {
  if (scope.kind !== "team") return resolveOwnerIds(tx, actor, scope, signal);
  signal.throwIfAborted();
  const members = await tx
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, scope.teamId))
    .orderBy(teamMembers.userId)
    .limit(MAX_DEAL_COHORT_SCOPE + 1);
  signal.throwIfAborted();
  return members.length > MAX_DEAL_COHORT_SCOPE
    ? null
    : onlyOwners(members.map(({ userId }) => userId));
}

function coveredInterval(bounds: CoverageBounds): Coverage | null {
  const { fromInclusive, toExclusive } = bounds.requested;
  const { activatedAt, observedAt } = bounds;
  if (
    compareInstants(fromInclusive, toExclusive) >= 0 ||
    compareInstants(toExclusive, activatedAt) <= 0 ||
    compareInstants(fromInclusive, observedAt) > 0 ||
    compareInstants(activatedAt, observedAt) > 0
  )
    return null;

  const startsBeforeCapture = compareInstants(fromInclusive, activatedAt) < 0;
  const endsAfterObservation = compareInstants(toExclusive, observedAt) > 0;
  return {
    ...bounds,
    state: startsBeforeCapture || endsAfterObservation ? "partial" : "complete",
    covered: {
      fromInclusive: startsBeforeCapture ? activatedAt : fromInclusive,
      to: endsAfterObservation ? observedAt : toExclusive,
      upperBound: endsAfterObservation ? "inclusive" : "exclusive",
    },
  };
}

async function readCohortSource(
  tx: Db,
  visible: SQL,
  actor: PermSetUser,
  activation: HistoryActivation,
  snapshot: string,
  coverage: Coverage,
  signal: AbortSignal,
): Promise<SourceRow | undefined> {
  const pipelineAuthority = visiblePipelinePredicate(actor) ?? sql`false`;
  const historicalDealAuthority = dealVisibilityPredicate(
    {
      userId: actor.id,
      isAdmin: actor.type === "admin",
      isActive: actor.isActive,
      sessionLive: true,
      groupIds: Array.from(actor.groupIds),
      managedUserIds: Array.from(actor.managedUserIds ?? []),
    },
    {
      ownerId: sql`side."ownerId"`,
      visibilityLevel: sql`side."visibilityLevel"`,
      visibilityGroupId: sql`side."visibilityGroupId"`,
      visibleToUserIds: sql`side."visibleToUserIds"`,
      pipelineVisibilityGroupId: sql`p.visibility_group_id`,
    },
  );
  const upperBound =
    coverage.covered.upperBound === "inclusive"
      ? sql`origin.observed_at <= ${coverage.covered.to}::timestamptz`
      : sql`origin.observed_at < ${coverage.covered.to}::timestamptz`;
  const result = await tx.execute(sql`
    WITH observation AS MATERIALIZED (
      SELECT ${snapshot}::pg_catalog.pg_snapshot AS snapshot
    ), scoped_deals AS MATERIALIZED (
      SELECT d.id FROM public.deals d JOIN public.pipelines p ON p.id = d.pipeline_id
      WHERE ${visible}
      LIMIT ${MAX_DEAL_COHORT_SCOPE + 1}
    ), origins AS MATERIALIZED (
      SELECT d.id, h.incarnation_id, h.last_event_ordinal,
        origin.ordinal AS first_ordinal, origin.event_kind, origin.observed_at,
        coalesce(
          tip.after_state = public.analytics_project_deal(d)
          AND origin.event_kind IN ('baseline','insert')
          AND origin.observed_at = h.incarnation_started_at
          AND origin.observed_at >= ${activation.activatedAt}::timestamptz
          AND tip.observed_at = h.last_observed_at
          AND tip.observed_at <= ${coverage.observedAt}::timestamptz
          AND pg_catalog.pg_visible_in_snapshot(tip.transaction_id::pg_catalog.xid8, o.snapshot)
          AND NOT EXISTS (
            SELECT 1 FROM public.analytics_history_events later
            WHERE later.entity_kind = h.entity_kind AND later.entity_id = h.entity_id
              AND later.activation_id = h.activation_id AND later.ordinal > h.last_event_ordinal
              AND pg_catalog.pg_visible_in_snapshot(later.transaction_id::pg_catalog.xid8, o.snapshot)
          ),
          false
        ) AS valid
      FROM scoped_deals scoped
      JOIN public.deals d ON d.id = scoped.id
      CROSS JOIN observation o
      LEFT JOIN public.analytics_history_heads h ON h.entity_kind = 'deal' AND h.entity_id = d.id
        AND h.active AND h.activation_id = ${activation.activationId}::uuid
      LEFT JOIN public.analytics_history_events tip ON tip.ordinal = h.last_event_ordinal
        AND tip.entity_kind = h.entity_kind AND tip.entity_id = h.entity_id
        AND tip.incarnation_id = h.incarnation_id AND tip.activation_id = h.activation_id
      LEFT JOIN LATERAL (
        SELECT e.ordinal, e.event_kind, e.observed_at
        FROM public.analytics_history_events e
        WHERE e.entity_kind = h.entity_kind AND e.entity_id = h.entity_id
          AND e.incarnation_id = h.incarnation_id AND e.activation_id = h.activation_id
          AND pg_catalog.pg_visible_in_snapshot(e.transaction_id::pg_catalog.xid8, o.snapshot)
        ORDER BY e.ordinal LIMIT 1
      ) origin ON true
      WHERE (SELECT count(*) FROM scoped_deals) <= ${MAX_DEAL_COHORT_SCOPE}
    ), entrants AS MATERIALIZED (
      SELECT id, incarnation_id, first_ordinal, last_event_ordinal FROM origins origin
      WHERE origin.valid AND origin.event_kind = 'insert'
        AND origin.observed_at >= ${coverage.covered.fromInclusive}::timestamptz AND ${upperBound}
    ), selected_events AS MATERIALIZED (
      SELECT e.*, entrant.first_ordinal, entrant.last_event_ordinal
      FROM entrants entrant
      JOIN public.analytics_history_events e ON e.entity_kind = 'deal' AND e.entity_id = entrant.id
        AND e.incarnation_id = entrant.incarnation_id AND e.activation_id = ${activation.activationId}::uuid
      CROSS JOIN observation o
      WHERE pg_catalog.pg_visible_in_snapshot(e.transaction_id::pg_catalog.xid8, o.snapshot)
      LIMIT ${MAX_DEAL_COHORT_HISTORY_EVENTS + 1}
    ), history_budget AS MATERIALIZED (
      SELECT count(*) > ${MAX_DEAL_COHORT_HISTORY_EVENTS} OR coalesce(sum(
        coalesce(octet_length(before_state::text), 0) + coalesce(octet_length(after_state::text), 0)
        + octet_length(observation_snapshot::text) + coalesce(octet_length(command_id), 0)
      ), 0) > ${MAX_HISTORY_PAYLOAD_BYTES} AS exceeded
      FROM selected_events
    ), event_sides AS MATERIALIZED (
      SELECT v.state FROM selected_events e
      CROSS JOIN LATERAL (VALUES (e.before_state), (e.after_state)) AS v(state)
      WHERE v.state IS NOT NULL AND NOT (SELECT exceeded FROM history_budget)
    ), access_sides AS MATERIALIZED (
      SELECT fields.* FROM event_sides s
      CROSS JOIN LATERAL pg_catalog.jsonb_to_record(s.state) AS fields(
        "pipelineId" pg_catalog.uuid, "ownerId" pg_catalog.uuid, "visibilityLevel" pg_catalog.text,
        "visibilityGroupId" pg_catalog.uuid, "visibleToUserIds" pg_catalog.uuid[]
      )
    ), event_pipelines AS MATERIALIZED (
      SELECT DISTINCT side."pipelineId" AS id FROM access_sides side
    ), permitted_pipelines AS MATERIALIZED (
      SELECT pipelines.id, pipelines.visibility_group_id FROM event_pipelines referenced
      JOIN public.pipelines ON pipelines.id = referenced.id
      JOIN public.analytics_history_heads h ON h.entity_kind = 'pipeline' AND h.entity_id = pipelines.id
        AND h.active AND h.activation_id = ${activation.activationId}::uuid
      JOIN public.analytics_history_events tip ON tip.ordinal = h.last_event_ordinal
        AND tip.entity_kind = h.entity_kind AND tip.entity_id = h.entity_id
        AND tip.incarnation_id = h.incarnation_id AND tip.activation_id = h.activation_id
      CROSS JOIN observation o
      WHERE pipelines.is_archived = false AND ${pipelineAuthority}
        AND tip.after_state = public.analytics_project_pipeline(pipelines)
        AND pg_catalog.pg_visible_in_snapshot(tip.transaction_id::pg_catalog.xid8, o.snapshot)
        AND NOT EXISTS (
          SELECT 1 FROM public.analytics_history_events prior
          WHERE prior.entity_kind = 'pipeline' AND prior.entity_id = pipelines.id
            AND prior.activation_id = h.activation_id
            AND (prior.incarnation_id <> h.incarnation_id OR prior.ordinal > h.last_event_ordinal)
            AND pg_catalog.pg_visible_in_snapshot(prior.transaction_id::pg_catalog.xid8, o.snapshot)
        )
    ), health AS MATERIALIZED (
      SELECT
        (SELECT count(*) FROM scoped_deals) > ${MAX_DEAL_COHORT_SCOPE} AS scope_limit,
        EXISTS (SELECT 1 FROM origins WHERE NOT valid) AS invalid_origin,
        (SELECT exceeded FROM history_budget) AS history_limit,
        EXISTS (
          SELECT 1 FROM access_sides side
          LEFT JOIN permitted_pipelines p ON p.id = side."pipelineId"
          WHERE p.id IS NULL OR NOT coalesce(${historicalDealAuthority}, false)
        ) AS permission_gap
    )
    SELECT health.scope_limit AS "scopeLimit", health.invalid_origin AS "invalidOrigin",
      health.permission_gap AS "permissionGap", health.history_limit AS "historyLimit",
      CASE WHEN health.scope_limit OR health.invalid_origin OR health.history_limit OR health.permission_gap
        THEN '[]'::json
        ELSE (SELECT coalesce(json_agg(json_build_object(
          'firstOrdinal', e.first_ordinal::text, 'lastOrdinal', e.last_event_ordinal::text,
          'event', json_build_object(
            'eventId', e.event_id, 'ordinal', e.ordinal::text, 'activationId', e.activation_id,
            'entityKind', e.entity_kind, 'entityId', e.entity_id, 'incarnationId', e.incarnation_id,
            'eventKind', e.event_kind, 'schemaVersion', e.schema_version,
            'transactionId', e.transaction_id, 'observationSnapshot', e.observation_snapshot::text,
            'observedAt', ${utcText(sql`e.observed_at`)},
            'beforeState', e.before_state, 'afterState', e.after_state,
            'beforeWriteVersion', e.before_write_version, 'afterWriteVersion', e.after_write_version,
            'actorId', e.actor_id, 'commandId', e.command_id
          )
        ) ORDER BY e.incarnation_id, e.ordinal), '[]'::json) FROM selected_events e)
      END AS events
    FROM health
  `);
  signal.throwIfAborted();
  return (result as unknown as { rows: SourceRow[] }).rows[0];
}

function isLive(state: HistoryState | null): state is HistoryState {
  return state !== null && state.archivedAt === null && state.deletedAt === null;
}

function qualifiedOutcome(
  events: AnalyticsHistoryEvent[],
  cutoff: string,
): CohortSubject["outcome"] | null {
  const folded = foldTransactionHistory(events);
  if (!folded.ok) return null;
  const [entry, ...later] = folded.changes;
  const insertedState = events[0]?.afterState ?? null;
  if (
    !isLive(insertedState) ||
    insertedState.status !== "open" ||
    entry === undefined ||
    !isLive(entry.afterState) ||
    entry.afterState.status !== "open"
  )
    return { kind: "unknown" };

  for (const change of later) {
    if (!isLive(change.beforeState) || !isLive(change.afterState)) return { kind: "unknown" };
    if (change.afterState.status !== "won") continue;
    if (change.beforeState.status !== "open") return { kind: "unknown" };
    const witness = change.eventIds.at(-1);
    return witness === undefined
      ? null
      : {
          kind: "event",
          basis: "qualified-win",
          eventId: `history:${witness}`,
          at: change.observedTo,
        };
  }
  return { kind: "no-event", basis: "qualified-win", observedThrough: cutoff };
}

interface DealChain {
  firstOrdinal: string;
  lastOrdinal: string;
  events: AnalyticsHistoryEvent[];
}

const chainRow = z.strictObject({
  firstOrdinal: z.string(),
  lastOrdinal: z.string(),
  event: analyticsHistoryEvent,
});

function appendDealEvent(chains: Map<string, DealChain>, row: z.output<typeof chainRow>): boolean {
  const { firstOrdinal, lastOrdinal, event } = row;
  const chain = chains.get(event.incarnationId);
  if (chain === undefined) {
    if (event.eventKind !== "insert" || event.ordinal !== firstOrdinal) return false;
    chains.set(event.incarnationId, { firstOrdinal, lastOrdinal, events: [event] });
    return true;
  }

  const prior = chain.events.at(-1);
  if (
    prior === undefined ||
    firstOrdinal !== chain.firstOrdinal ||
    lastOrdinal !== chain.lastOrdinal ||
    prior.entityId !== event.entityId ||
    BigInt(event.ordinal) <= BigInt(prior.ordinal) ||
    compareInstants(event.observedAt, prior.observedAt) < 0 ||
    event.eventKind !== "update" ||
    !sameHistoryState(prior.afterState, event.beforeState)
  )
    return false;
  chain.events.push(event);
  return true;
}

function readChains(
  rows: readonly unknown[],
  activationId: string,
  observedAt: string,
): Map<string, DealChain> | null {
  const chains = new Map<string, DealChain>();
  for (const row of rows) {
    const parsed = chainRow.safeParse(row);
    if (!parsed.success) return null;
    const { event } = parsed.data;
    if (
      event.entityKind !== "deal" ||
      event.activationId !== activationId ||
      compareInstants(event.observedAt, observedAt) > 0 ||
      !appendDealEvent(chains, parsed.data)
    )
      return null;
  }
  return chains;
}

function cohortSubjects(
  chains: ReadonlyMap<string, DealChain>,
  observedAt: string,
  locale: LocaleScope,
): CohortSubject[] | null {
  const subjects: CohortSubject[] = [];
  for (const { events, lastOrdinal } of chains.values()) {
    const entry = events[0];
    if (entry === undefined || events.at(-1)?.ordinal !== lastOrdinal) return null;
    const outcome = qualifiedOutcome(events, observedAt);
    if (outcome === null) return null;
    const day = Temporal.Instant.from(entry.observedAt)
      .toZonedDateTimeISO(locale.timeZone)
      .toPlainDate()
      .toString();
    const month = startOfCalendarMonth(new Date(`${day}T00:00:00Z`), locale);
    subjects.push({
      subjectId: `deal:${entry.incarnationId}`,
      bucketId: month.toISOString().slice(0, 10),
      entryBasis: "observed-deal-insert",
      entryEventId: `history:${entry.eventId}`,
      enteredAt: entry.observedAt,
      outcome,
    });
  }
  return subjects;
}

interface CohortReadContext {
  state: "ready";
  actor: PermSetUser;
  activation: HistoryActivation;
  snapshot: string;
  locale: LocaleScope;
  coverage: Coverage;
  effectiveOwnerScope: OwnerScope["kind"];
  visible: SQL;
}

async function readCohortContext(
  tx: Db,
  actor: PermSetUser,
  request: ObservedDealWinCohortRequest,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<CohortReadContext | Unavailable> {
  // Acquire the native repeatable-read snapshot with its cutoff before scope reads.
  const observation = await tx.execute(sql`
    SELECT pg_catalog.pg_current_snapshot()::text AS snapshot,
      ${utcText(sql`pg_catalog.clock_timestamp()`)} AS cutoff
  `);
  const witness = snapshotRow.safeParse(observation.rows[0]);
  if (!witness.success) return { state: "unavailable", reason: "history-read-failed" };
  const { snapshot, cutoff: observedAt } = witness.data;

  const live = await currentActor(tx, actor, signal);
  if (
    live === null ||
    (request.pipelineId !== null &&
      !(await isPipelineVisible(tx, live, request.pipelineId, signal)))
  )
    return { state: "unavailable", reason: "not-authorized" };
  const installation = await readHistoryInstallation(tx, signal);
  if (installation.state !== "installed") return installation;

  const saved = await getPreferences(tx, live.id, signal);
  const locale = resolveAccountLocalePreferences({
    saved: saved.ui.localePreferences,
    profileTimeZone: saved.timezone,
    fallback: localeFallback,
  });
  const period = reportPeriod({ ...request, timeZone: locale.timeZone });
  const bounds = await tx.execute(sql`
    SELECT ${utcText(period.from)} AS "fromInclusive", ${utcText(period.toExclusive)} AS "toExclusive"
  `);
  const requested = (bounds as unknown as { rows: CoverageBounds["requested"][] }).rows[0];
  if (requested === undefined) return { state: "unavailable", reason: "history-read-failed" };
  const coverageBounds = {
    requested,
    activatedAt: installation.activation.activatedAt,
    observedAt,
  };
  const coverage = coveredInterval(coverageBounds);
  if (coverage === null)
    return { state: "unavailable", reason: "period-outside-capture", coverage: coverageBounds };

  const selectedOwners = ownerScope(live, request.ownerScope);
  const owners = await resolveCohortOwners(tx, live, selectedOwners, signal);
  if (owners === null) return { state: "unavailable", reason: "scope-limit" };
  const visible = await visibleDealPopulation(tx, live, { ...request, owners }, signal);
  return {
    state: "ready",
    actor: live,
    activation: installation.activation,
    snapshot,
    locale,
    coverage,
    effectiveOwnerScope: selectedOwners.kind,
    visible,
  };
}

async function readCohortSubjects(
  tx: Db,
  context: CohortReadContext,
  signal: AbortSignal,
): Promise<CohortSubject[] | Unavailable> {
  const { actor, activation, snapshot, locale, coverage, visible } = context;
  const source = await readCohortSource(tx, visible, actor, activation, snapshot, coverage, signal);
  if (source === undefined) return { state: "unavailable", reason: "history-read-failed" };
  if (source.scopeLimit) return { state: "unavailable", reason: "scope-limit" };
  if (source.historyLimit) return { state: "unavailable", reason: "history-limit" };
  if (source.invalidOrigin) return { state: "unavailable", reason: "history-invalid" };
  if (source.permissionGap) return { state: "unavailable", reason: "history-permission-limited" };

  const chains = readChains(source.events, activation.activationId, coverage.observedAt);
  const subjects = chains === null ? null : cohortSubjects(chains, coverage.observedAt, locale);
  if (subjects === null) return { state: "unavailable", reason: "history-invalid" };
  return subjects;
}

async function readInSnapshot(
  tx: Db,
  actor: PermSetUser,
  request: ObservedDealWinCohortRequest,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<ObservedDealWinCohorts> {
  const context = await readCohortContext(tx, actor, request, signal, localeFallback);
  if (context.state !== "ready") return context;
  const subjects = await readCohortSubjects(tx, context, signal);
  if (!Array.isArray(subjects)) return subjects;
  const { coverage, locale } = context;
  const result = computeEqualAgeCohorts({
    source: {
      definitionId: DEFINITION_ID,
      completeness: "complete",
      entryBasis: "observed-deal-insert",
      outcomeBasis: "qualified-win",
    },
    calendar: locale.calendar,
    timeZone: locale.timeZone,
    observationCutoff: coverage.observedAt,
    horizon: request.horizon,
    subjects,
  });
  if (result.state === "unavailable") {
    return {
      state: "unavailable",
      reason: result.reason === "invalid-request" ? "invalid-request" : "history-invalid",
    };
  }
  return {
    state: "available",
    population: "current-authorized-live-deals",
    effectiveOwnerScope: context.effectiveOwnerScope,
    baseline: "excluded",
    bucketMembership: "entries-within-covered-interval",
    coverage,
    result,
  };
}

// Internal report collector. Current authority covers the live deal and each retained
// side used for the cohort. It does not attest historical actor entitlements. Facts are
// established together. A borrowed client or nested transaction cannot prove that scope.
export async function readObservedDealWinCohorts(
  db: Db,
  actor: PermSetUser,
  input: ObservedDealWinCohortRequest,
  signal: AbortSignal,
  localeFallback?: LocalePreferenceFallback,
): Promise<ObservedDealWinCohorts> {
  signal.throwIfAborted();
  const request = requestSchema.safeParse(input);
  if (!request.success) return { state: "unavailable", reason: "invalid-request" };
  if (!("$client" in db) || !(db.$client instanceof Pool))
    return { state: "unavailable", reason: "history-read-failed" };

  try {
    return await db.transaction(
      async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
        await tx.execute(sql`SET LOCAL lock_timeout = '2000ms'`);
        const result = await readInSnapshot(tx, actor, request.data, signal, localeFallback);
        signal.throwIfAborted();
        return result;
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return { state: "unavailable", reason: "history-read-failed" };
  }
}
