import { eq, type SQL, sql } from "drizzle-orm";
import { Pool } from "pg";
import { z } from "zod";
import type { Db } from "@/db/client";
import { teamMembers } from "@/db/schema";
import { currencyCode } from "@/features/currencies/currencySchema";
import type { PermSetUser } from "@/features/permissions/effective";
import { dealVisibilityPredicate } from "@/features/permissions/sql";
import { readBaseCurrency } from "@/features/settings/readBaseCurrency";
import { visibleDealPopulation } from "@/features/stats/dealPopulation";
import { onlyOwners, resolveOwnerIds } from "@/features/stats/ownerIds";
import { ownerScope } from "@/features/stats/ownerScope";
import { isPipelineVisible, visiblePipelinePredicate } from "@/features/stats/visiblePipelines";
import { hydrateActor } from "@/server/hydrateActor";
import type { OwnerScope } from "@/types/stats";
import {
  type AnalyticsHistoryEvent,
  analyticsHistoryEvent,
  type HistoryActivation,
  type HistoryState,
  historyOrdinal,
  historyUuid,
  historyVisibilitySnapshot,
} from "./contracts";
import { foldTransactionHistory, sameHistoryState } from "./fold";
import { type HistoryInstallation, readHistoryInstallation } from "./repository";
import {
  type AuthorizedCurrentStageLabel,
  projectStageAgingView,
  type StageAgingObservation,
  type StageAgingView,
  type StageAgingViewSource,
} from "./stageAgingView";
import {
  deriveStageEpisodes,
  type StageEpisodesResult,
  type StageEpisodeUnavailableReason,
} from "./stageEpisodes";
import { aggregateStageStatistics, type StageStatisticsResult } from "./stageStatistics";

export const MAX_CURRENT_STAGE_AGING_DEALS = 1_000;
export const MAX_CURRENT_STAGE_AGING_EVENTS = 5_000;
const MAX_VARIABLE_HISTORY_BYTES = 8 * 1024 * 1024;
const MAX_LABEL_NAME_LENGTH = 255;
const MAX_LABEL_NAME_BYTES = MAX_LABEL_NAME_LENGTH * 4;
const MAX_LABEL_PAYLOAD_BYTES = 2 * 1024 * 1024;

const uuid = historyUuid.transform((id) => id.toLowerCase());
const requestSchema = z.strictObject({
  pipelineId: uuid.nullable().default(null),
  ownerScope: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("me") }),
      z.strictObject({ kind: z.literal("all") }),
      z.strictObject({ kind: z.literal("user"), userId: uuid }),
      z.strictObject({ kind: z.literal("team"), teamId: uuid }),
    ])
    .default({ kind: "me" }),
  currency: currencyCode.optional(),
});
const utcInstant = z.string().datetime({ precision: 6 });
const snapshotSchema = z.strictObject({
  snapshot: historyVisibilitySnapshot,
  cutoff: utcInstant,
});
const sourceSchema = z.strictObject({
  dealCount: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_CURRENT_STAGE_AGING_DEALS + 1),
  ownWritesPending: z.boolean(),
  scopeLimit: z.boolean(),
  historyLimit: z.boolean(),
  invalidHead: z.boolean(),
  historyPermissionGap: z.boolean(),
  stageGap: z.boolean(),
  events: z.array(z.unknown()).max(MAX_CURRENT_STAGE_AGING_EVENTS),
});
const eventRowSchema = z.strictObject({
  startedAt: utcInstant,
  tipOrdinal: historyOrdinal,
  event: analyticsHistoryEvent,
});
const definitionName = z
  .string()
  .max(MAX_LABEL_NAME_LENGTH)
  .refine((name) => name.trim() !== "");
const definitionLabels = z.array(
  z.strictObject({
    pipelineId: historyUuid,
    stageId: historyUuid,
    pipelineName: definitionName,
    stageName: definitionName,
  }),
);

export type CurrentStageAgingRequest = z.input<typeof requestSchema>;
type Observation = z.output<typeof snapshotSchema>;
type Source = z.output<typeof sourceSchema>;
type EventRow = z.output<typeof eventRowSchema>;
type Episodes = Extract<StageEpisodesResult, { ok: true }>;

export type CurrentStageAging =
  | Exclude<HistoryInstallation, { state: "installed" }>
  | {
      state: "unavailable";
      reason:
        | "invalid-request"
        | "not-authorized"
        | "history-read-failed"
        | "source-writes-pending"
        | "scope-limit"
        | "history-limit"
        | "history-invalid"
        | "history-permission-limited"
        | "stage-definition-unavailable";
    }
  | {
      state: "unavailable";
      reason: "aging-evidence-unavailable";
      detail: StageEpisodeUnavailableReason;
    }
  | {
      state: "available";
      currency: string;
      population: {
        basis: "current-authorized-live-deals";
        dealCount: number;
        currentOpenDealCount: number;
      };
      historyBasis: "observed-stays-of-current-cohort-since-capture";
      activatedAt: string;
      statistics: Extract<StageStatisticsResult, { ok: true }>;
    };

type AvailableAging = Extract<CurrentStageAging, { state: "available" }>;
type Unavailable = Exclude<CurrentStageAging, AvailableAging>;
const utcText = (value: SQL) =>
  sql`pg_catalog.to_char(${value} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

async function currentActor(tx: Db, request: PermSetUser, signal: AbortSignal) {
  if (!request.isActive) return null;
  const live = await hydrateActor(tx, request.id, signal);
  if (live === null || request.type === "admin") return live;
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

async function boundedOwners(tx: Db, actor: PermSetUser, scope: OwnerScope, signal: AbortSignal) {
  if (scope.kind !== "team") return resolveOwnerIds(tx, actor, scope, signal);
  signal.throwIfAborted();
  const members = await tx
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, scope.teamId))
    .orderBy(teamMembers.userId)
    .limit(MAX_CURRENT_STAGE_AGING_DEALS + 1);
  signal.throwIfAborted();
  return members.length > MAX_CURRENT_STAGE_AGING_DEALS
    ? null
    : onlyOwners(members.map(({ userId }) => userId));
}

interface SourceContext {
  state: "ready";
  actor: PermSetUser;
  pipelineId: string | null;
  currency: string;
  effectiveOwnerScope: OwnerScope["kind"];
  visible: SQL;
  activation: HistoryActivation;
  observation: Observation;
}

async function readSourceContext(
  tx: Db,
  requestActor: PermSetUser,
  request: z.output<typeof requestSchema>,
  signal: AbortSignal,
): Promise<SourceContext | Unavailable> {
  // This first data read takes the native repeatable-read snapshot before authority is resolved.
  signal.throwIfAborted();
  const result = await tx.execute(sql`
    SELECT pg_catalog.pg_current_snapshot()::text AS snapshot,
      ${utcText(sql`pg_catalog.clock_timestamp()`)} AS cutoff
  `);
  const observation = snapshotSchema.safeParse(result.rows[0]);
  if (!observation.success) return { state: "unavailable", reason: "history-read-failed" };
  const actor = await currentActor(tx, requestActor, signal);
  if (actor === null) return { state: "unavailable", reason: "not-authorized" };
  if (
    request.pipelineId !== null &&
    !(await isPipelineVisible(tx, actor, request.pipelineId, signal))
  )
    return { state: "unavailable", reason: "not-authorized" };
  const installation = await readHistoryInstallation(tx, signal);
  if (installation.state !== "installed") return installation;
  if (installation.activation.activatedAt > observation.data.cutoff)
    return { state: "unavailable", reason: "history-invalid" };

  const effectiveScope = ownerScope(actor, request.ownerScope);
  const owners = await boundedOwners(tx, actor, effectiveScope, signal);
  if (owners === null) return { state: "unavailable", reason: "scope-limit" };
  const currency = request.currency ?? (await readBaseCurrency(tx, signal));
  const supported = currencyCode.safeParse(currency);
  if (!supported.success || supported.data !== currency)
    return { state: "unavailable", reason: "invalid-request" };
  // The shared current-deal predicate does not consume date fields. Stage stays are derived
  // from the complete captured chain through this cutoff, rather than clipping their edges.
  const day = observation.data.cutoff.slice(0, 10);
  const visible = await visibleDealPopulation(
    tx,
    actor,
    { currency, pipelineId: request.pipelineId, owners, from: day, to: day },
    signal,
  );
  return {
    state: "ready",
    actor,
    pipelineId: request.pipelineId,
    currency,
    effectiveOwnerScope: effectiveScope.kind,
    visible,
    activation: installation.activation,
    observation: observation.data,
  };
}

async function readAgingSource(tx: Db, context: SourceContext, signal: AbortSignal) {
  const { activation, actor, observation, pipelineId, visible } = context;
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
  signal.throwIfAborted();
  const result = await tx.execute(sql`
    WITH observation AS MATERIALIZED (
      SELECT ${observation.snapshot}::pg_catalog.pg_snapshot AS snapshot,
        ${observation.cutoff}::timestamptz AS cutoff,
        EXISTS (SELECT 1 FROM public.analytics_history_events pending
          WHERE pending.transaction_id = pg_catalog.pg_current_xact_id_if_assigned()::text
        ) AS own_pending
    ), candidates AS MATERIALIZED (
      SELECT d.id FROM public.deals d JOIN public.pipelines p ON p.id = d.pipeline_id
      WHERE ${visible}
      LIMIT ${MAX_CURRENT_STAGE_AGING_DEALS + 1}
    ), cohort_size AS MATERIALIZED (
      SELECT count(*)::int AS deal_count FROM candidates
    ), deal_heads AS MATERIALIZED (
      SELECT d.id, h.incarnation_id, h.incarnation_started_at, h.last_event_ordinal,
        coalesce(
          tip.after_state = public.analytics_project_deal(d)
          AND h.incarnation_started_at >= ${activation.activatedAt}::timestamptz
          AND tip.observed_at = h.last_observed_at AND tip.observed_at <= o.cutoff
          AND pg_catalog.pg_visible_in_snapshot(tip.transaction_id::pg_catalog.xid8, o.snapshot)
          AND NOT EXISTS (
            SELECT 1 FROM public.analytics_history_events later
            WHERE later.entity_kind = h.entity_kind AND later.entity_id = h.entity_id
              AND later.activation_id = h.activation_id AND later.ordinal > h.last_event_ordinal
              AND pg_catalog.pg_visible_in_snapshot(later.transaction_id::pg_catalog.xid8, o.snapshot)
          ), false
        ) AS valid
      FROM candidates c JOIN public.deals d ON d.id = c.id
      CROSS JOIN observation o
      LEFT JOIN public.analytics_history_heads h ON h.entity_kind = 'deal' AND h.entity_id = d.id
        AND h.active AND h.activation_id = ${activation.activationId}::uuid
      LEFT JOIN public.analytics_history_events tip ON tip.ordinal = h.last_event_ordinal
        AND tip.entity_kind = h.entity_kind AND tip.entity_id = h.entity_id
        AND tip.activation_id = h.activation_id AND tip.incarnation_id = h.incarnation_id
      WHERE (SELECT deal_count FROM cohort_size) <= ${MAX_CURRENT_STAGE_AGING_DEALS}
        AND NOT o.own_pending
    ), invalid_head AS MATERIALIZED (
      SELECT EXISTS (SELECT 1 FROM deal_heads WHERE NOT valid) AS present
    ), selected_events AS MATERIALIZED (
      SELECT e.*, h.incarnation_started_at, h.last_event_ordinal
      FROM deal_heads h JOIN public.analytics_history_events e ON e.entity_kind = 'deal'
        AND e.entity_id = h.id AND e.incarnation_id = h.incarnation_id
        AND e.activation_id = ${activation.activationId}::uuid
      CROSS JOIN observation o
      WHERE NOT (SELECT present FROM invalid_head)
        AND pg_catalog.pg_visible_in_snapshot(e.transaction_id::pg_catalog.xid8, o.snapshot)
      LIMIT ${MAX_CURRENT_STAGE_AGING_EVENTS + 1}
    ), history_budget AS MATERIALIZED (
      SELECT count(*) > ${MAX_CURRENT_STAGE_AGING_EVENTS} OR coalesce(sum(
        coalesce(octet_length(before_state::text), 0) + coalesce(octet_length(after_state::text), 0)
        + octet_length(observation_snapshot::text) + coalesce(octet_length(command_id), 0)
      ), 0) > ${MAX_VARIABLE_HISTORY_BYTES} AS exceeded FROM selected_events
    ), event_states AS MATERIALIZED (
      SELECT before_state AS state FROM selected_events
      WHERE before_state IS NOT NULL AND NOT (SELECT exceeded FROM history_budget)
      UNION ALL
      SELECT after_state FROM selected_events
      WHERE after_state IS NOT NULL AND NOT (SELECT exceeded FROM history_budget)
    ), access_sides AS MATERIALIZED (
      SELECT fields.* FROM event_states e
      CROSS JOIN LATERAL pg_catalog.jsonb_to_record(e.state) AS fields(
        "pipelineId" pg_catalog.uuid, "ownerId" pg_catalog.uuid, "visibilityLevel" pg_catalog.text,
        "visibilityGroupId" pg_catalog.uuid, "visibleToUserIds" pg_catalog.uuid[]
      )
    ), definition_refs AS MATERIALIZED (
      SELECT 'pipeline' AS kind, state ->> 'pipelineId' AS id, NULL::text AS parent FROM event_states
      UNION SELECT 'stage', state ->> 'stageId', state ->> 'pipelineId' FROM event_states
      UNION SELECT 'pipeline', ${pipelineId}::text, NULL::text WHERE ${pipelineId}::uuid IS NOT NULL
        AND (SELECT deal_count FROM cohort_size) <= ${MAX_CURRENT_STAGE_AGING_DEALS}
        AND NOT (SELECT own_pending FROM observation)
        AND NOT (SELECT present FROM invalid_head) AND NOT (SELECT exceeded FROM history_budget)
    ), current_definitions AS MATERIALIZED (
      SELECT ref.kind, pipelines.id, ref.parent, public.analytics_project_pipeline(pipelines) AS state,
        pipelines.visibility_group_id
      FROM definition_refs ref JOIN public.pipelines ON pipelines.id = ref.id::uuid
      WHERE ref.kind = 'pipeline' AND pipelines.is_archived = false AND ${pipelineAuthority}
      UNION ALL
      SELECT ref.kind, s.id, ref.parent, public.analytics_project_stage(s), NULL::pg_catalog.uuid
      FROM definition_refs ref JOIN public.stages s ON s.id = ref.id::uuid
        AND s.pipeline_id = ref.parent::uuid
      WHERE ref.kind = 'stage'
    ), permitted_definitions AS MATERIALIZED (
      SELECT source.kind, source.id, source.parent, source.visibility_group_id
      FROM current_definitions source
      JOIN public.analytics_history_heads h ON h.entity_kind = source.kind AND h.entity_id = source.id
        AND h.active AND h.activation_id = ${activation.activationId}::uuid
      JOIN public.analytics_history_events tip ON tip.ordinal = h.last_event_ordinal
        AND tip.entity_kind = h.entity_kind AND tip.entity_id = h.entity_id
        AND tip.activation_id = h.activation_id AND tip.incarnation_id = h.incarnation_id
      CROSS JOIN observation o
      WHERE tip.after_state = source.state AND tip.observed_at = h.last_observed_at
        AND tip.observed_at <= o.cutoff
        AND pg_catalog.pg_visible_in_snapshot(tip.transaction_id::pg_catalog.xid8, o.snapshot)
        AND NOT EXISTS (
          SELECT 1 FROM public.analytics_history_events previous
          WHERE previous.entity_kind = h.entity_kind AND previous.entity_id = h.entity_id
            AND previous.activation_id = h.activation_id
            AND pg_catalog.pg_visible_in_snapshot(previous.transaction_id::pg_catalog.xid8, o.snapshot)
            AND (previous.incarnation_id <> h.incarnation_id OR previous.ordinal > h.last_event_ordinal
              OR (source.kind = 'stage' AND (
                (previous.before_state IS NOT NULL AND previous.before_state ->> 'pipelineId' IS DISTINCT FROM source.parent)
                OR (previous.after_state IS NOT NULL AND previous.after_state ->> 'pipelineId' IS DISTINCT FROM source.parent)
              ))
            )
        )
    ), gaps AS MATERIALIZED (
      SELECT ref.kind FROM definition_refs ref LEFT JOIN permitted_definitions permitted
        ON permitted.kind = ref.kind AND permitted.id = ref.id::uuid
        AND permitted.parent IS NOT DISTINCT FROM ref.parent
      WHERE permitted.id IS NULL
    ), health AS MATERIALIZED (
      SELECT c.deal_count, o.own_pending, c.deal_count > ${MAX_CURRENT_STAGE_AGING_DEALS} AS scope_limit,
        (SELECT present FROM invalid_head) AS invalid_head,
        (SELECT exceeded FROM history_budget) AS history_limit,
        (EXISTS (SELECT 1 FROM gaps WHERE kind = 'pipeline') OR EXISTS (
          SELECT 1 FROM access_sides side
          LEFT JOIN permitted_definitions p ON p.kind = 'pipeline' AND p.id = side."pipelineId"
          WHERE p.id IS NULL OR NOT coalesce(${historicalDealAuthority}, false)
        )) AS history_permission_gap,
        EXISTS (SELECT 1 FROM gaps WHERE kind = 'stage') AS stage_gap
      FROM cohort_size c CROSS JOIN observation o
    )
    SELECT deal_count AS "dealCount", own_pending AS "ownWritesPending",
      scope_limit AS "scopeLimit", invalid_head AS "invalidHead", history_limit AS "historyLimit",
      history_permission_gap AS "historyPermissionGap", stage_gap AS "stageGap",
      CASE WHEN own_pending OR scope_limit OR invalid_head OR history_limit OR history_permission_gap OR stage_gap
        THEN '[]'::json
        ELSE (SELECT coalesce(json_agg(json_build_object(
          'startedAt', ${utcText(sql`e.incarnation_started_at`)}, 'tipOrdinal', e.last_event_ordinal::text,
          'event', json_build_object(
            'eventId', e.event_id, 'ordinal', e.ordinal::text, 'activationId', e.activation_id,
            'entityKind', e.entity_kind, 'entityId', e.entity_id, 'incarnationId', e.incarnation_id,
            'eventKind', e.event_kind, 'schemaVersion', e.schema_version,
            'transactionId', e.transaction_id, 'observationSnapshot', e.observation_snapshot::text,
            'observedAt', ${utcText(sql`e.observed_at`)}, 'beforeState', e.before_state,
            'afterState', e.after_state, 'beforeWriteVersion', e.before_write_version,
            'afterWriteVersion', e.after_write_version, 'actorId', e.actor_id, 'commandId', e.command_id
          )
        ) ORDER BY e.entity_id, e.ordinal), '[]'::json) FROM selected_events e)
      END AS events
    FROM health
  `);
  signal.throwIfAborted();
  const parsed = sourceSchema.safeParse(result.rows[0]);
  return parsed.success ? parsed.data : null;
}

function sourceFailure(source: Source): Unavailable | null {
  if (source.ownWritesPending) return { state: "unavailable", reason: "source-writes-pending" };
  if (source.scopeLimit) return { state: "unavailable", reason: "scope-limit" };
  if (source.historyLimit) return { state: "unavailable", reason: "history-limit" };
  if (source.invalidHead) return { state: "unavailable", reason: "history-invalid" };
  if (source.historyPermissionGap)
    return { state: "unavailable", reason: "history-permission-limited" };
  if (source.stageGap) return { state: "unavailable", reason: "stage-definition-unavailable" };
  return null;
}

interface DealChain {
  startedAt: string;
  tipOrdinal: string;
  events: AnalyticsHistoryEvent[];
}

function appendEvent(chains: Map<string, DealChain>, row: EventRow, activation: HistoryActivation) {
  const { event, startedAt, tipOrdinal } = row;
  const chain = chains.get(event.entityId);
  if (chain === undefined) {
    if (
      event.observedAt !== startedAt ||
      (event.eventKind !== "baseline" && event.eventKind !== "insert")
    )
      return false;
    if (event.eventKind === "baseline" && startedAt !== activation.activatedAt) return false;
    chains.set(event.entityId, { startedAt, tipOrdinal, events: [event] });
    return true;
  }
  const prior = chain.events.at(-1);
  if (
    prior === undefined ||
    event.eventKind !== "update" ||
    event.incarnationId !== prior.incarnationId ||
    startedAt !== chain.startedAt ||
    tipOrdinal !== chain.tipOrdinal ||
    event.observedAt < prior.observedAt ||
    BigInt(event.ordinal) <= BigInt(prior.ordinal) ||
    !sameHistoryState(prior.afterState, event.beforeState)
  )
    return false;
  chain.events.push(event);
  return true;
}

function hasRecordedLifecycle(state: HistoryState | null): boolean {
  if (state === null) return true;
  return (
    (state.archivedAt === null || utcInstant.safeParse(state.archivedAt).success) &&
    (state.deletedAt === null || utcInstant.safeParse(state.deletedAt).success)
  );
}

function readChains(source: Source, activation: HistoryActivation, cutoff: string) {
  const chains = new Map<string, DealChain>();
  for (const row of source.events) {
    const parsed = eventRowSchema.safeParse(row);
    if (!parsed.success) return null;
    const event = parsed.data.event;
    if (
      event.entityKind !== "deal" ||
      event.activationId !== activation.activationId ||
      !utcInstant.safeParse(event.observedAt).success ||
      event.observedAt > cutoff ||
      !hasRecordedLifecycle(event.beforeState) ||
      !hasRecordedLifecycle(event.afterState) ||
      !appendEvent(chains, parsed.data, activation)
    )
      return null;
  }
  if (chains.size !== source.dealCount) return null;
  return chains;
}

function derivePopulation(chains: ReadonlyMap<string, DealChain>, cutoff: string) {
  const episodes: Episodes[] = [];
  for (const chain of chains.values()) {
    if (chain.events.at(-1)?.ordinal !== chain.tipOrdinal)
      return { state: "unavailable", reason: "history-invalid" } as const;
    const fold = foldTransactionHistory(chain.events);
    if (!fold.ok) return { state: "unavailable", reason: "history-invalid" } as const;
    const result = deriveStageEpisodes(fold.changes, cutoff);
    if (!result.ok)
      return {
        state: "unavailable",
        reason: "aging-evidence-unavailable",
        detail: result.reason,
      } as const;
    episodes.push(result);
  }
  return { state: "ready", episodes } as const;
}

type SnapshotCollection = {
  state: "collected";
  report: AvailableAging;
  context: SourceContext;
};

async function readInSnapshot(
  tx: Db,
  actor: PermSetUser,
  request: z.output<typeof requestSchema>,
  signal: AbortSignal,
): Promise<SnapshotCollection | Unavailable> {
  const context = await readSourceContext(tx, actor, request, signal);
  if (context.state !== "ready") return context;
  const source = await readAgingSource(tx, context, signal);
  if (source === null) return { state: "unavailable", reason: "history-read-failed" };
  const failure = sourceFailure(source);
  if (failure !== null) return failure;
  const { activation, observation, currency } = context;
  const chains = readChains(source, activation, observation.cutoff);
  if (chains === null) return { state: "unavailable", reason: "history-invalid" };
  const population = derivePopulation(chains, observation.cutoff);
  if (population.state !== "ready") return population;
  const statistics = aggregateStageStatistics(population.episodes, {
    activationId: activation.activationId,
    observationCutoff: observation.cutoff,
  });
  if (!statistics.ok)
    return {
      state: "unavailable",
      reason: statistics.reason === "bounded-limit" ? "history-limit" : "history-invalid",
    };
  return {
    state: "collected",
    context,
    report: {
      state: "available",
      currency,
      population: {
        basis: "current-authorized-live-deals",
        dealCount: source.dealCount,
        currentOpenDealCount: population.episodes.filter(
          (row) => row.finalObservedStatus === "open",
        ).length,
      },
      historyBasis: "observed-stays-of-current-cohort-since-capture",
      activatedAt: activation.activatedAt,
      statistics,
    },
  };
}

async function inStageAgingSnapshot<Result>(
  db: Db,
  actor: PermSetUser,
  input: CurrentStageAgingRequest,
  signal: AbortSignal,
  collect: (tx: Db, source: SnapshotCollection) => Result | Promise<Result>,
): Promise<Result | Unavailable> {
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
        const source = await readInSnapshot(tx, actor, request.data, signal);
        signal.throwIfAborted();
        if (source.state !== "collected") return source;
        const result = await collect(tx, source);
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

// This internal read describes captured stays of the current cohort, including completed stays
// on still-live closed deals. Current filters select the cohort and do not rewrite old visits.
// Current grants must permit every captured deal side and its referenced current pipeline.
// The checks include intermediate sides eliminated by transaction folding. A retained-record
// report needs its own authority.
export function readCurrentStageAging(
  db: Db,
  actor: PermSetUser,
  input: CurrentStageAgingRequest,
  signal: AbortSignal,
): Promise<CurrentStageAging> {
  return inStageAgingSnapshot(db, actor, input, signal, (_tx, { report }) => report);
}

async function readDefinitionLabels(
  tx: Db,
  source: SnapshotCollection,
  signal: AbortSignal,
): Promise<AuthorizedCurrentStageLabel[] | null> {
  const pairs = source.report.statistics.groups.map(({ pipelineId, stageId }) => ({
    pipelineId,
    stageId,
  }));
  if (pairs.length === 0) return [];
  const pipelineAuthority = visiblePipelinePredicate(source.context.actor) ?? sql`false`;

  // The preceding evidence read checked every captured stage and parent reference under
  // this same RR snapshot. Restrict names to the grouped pairs and reapply parent visibility.
  signal.throwIfAborted();
  const result = await tx.execute(sql`
    WITH labels AS MATERIALIZED (
      SELECT pipelines.id AS "pipelineId", s.id AS "stageId",
        pipelines.name AS "pipelineName", s.name AS "stageName"
      FROM pg_catalog.jsonb_to_recordset(${JSON.stringify(pairs)}::pg_catalog.jsonb)
        AS ref("pipelineId" pg_catalog.uuid, "stageId" pg_catalog.uuid)
      JOIN public.pipelines ON pipelines.id = ref."pipelineId"
      JOIN public.stages s ON s.id = ref."stageId" AND s.pipeline_id = pipelines.id
      WHERE pipelines.is_archived = false AND ${pipelineAuthority}
        AND pg_catalog.octet_length(pipelines.name) <= ${MAX_LABEL_NAME_BYTES}
        AND pg_catalog.octet_length(s.name) <= ${MAX_LABEL_NAME_BYTES}
    )
    SELECT "pipelineId", "stageId", "pipelineName", "stageName" FROM labels WHERE (
      SELECT coalesce(sum(pg_catalog.octet_length("pipelineName") + pg_catalog.octet_length("stageName")), 0)
      FROM labels
    ) <= ${MAX_LABEL_PAYLOAD_BYTES}
  `);
  signal.throwIfAborted();
  const labels = definitionLabels.safeParse(result.rows);
  return labels.success && labels.data.length === pairs.length ? labels.data : null;
}

/** Internal viewer read. The authenticated request supplies the actor. */
export async function readCurrentStageAgingView(
  db: Db,
  actor: PermSetUser,
  input: CurrentStageAgingRequest,
  signal: AbortSignal,
): Promise<StageAgingView> {
  const source = await inStageAgingSnapshot<StageAgingViewSource>(
    db,
    actor,
    input,
    signal,
    async (tx, collection) => {
      const { report, context } = collection;
      const labels = await readDefinitionLabels(tx, collection, signal);
      if (labels === null) return { state: "unavailable", reason: "stage-definition-unavailable" };
      const observation: StageAgingObservation = {
        activationId: context.activation.activationId,
        observationCutoff: context.observation.cutoff,
      };
      return {
        state: "collected",
        report,
        observation,
        effectiveOwnerScope: context.effectiveOwnerScope,
        definitions: { observation, labels },
      };
    },
  );
  signal.throwIfAborted();
  return projectStageAgingView(source);
}
