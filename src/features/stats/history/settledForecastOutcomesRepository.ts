import { type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { currentNativeReadActor, type NativeSessionRef } from "@/features/auth/currentNativeActor";
import type { PermSetUser } from "@/features/permissions/effective";
import { restrictReportActor } from "../hydrateReportActor";
import { visiblePipelinePredicate } from "../visiblePipelines";
import { analyticsHistoryEvent, historyUuid, historyVisibilitySnapshot } from "./contracts";
import type { PrivateForecastCommitProof } from "./forecastCommitQualification";
import { readHistoryInstallation } from "./repository";
import {
  classifySettledForecastOutcome,
  type OutcomeFence,
  type SavedOpenForecastMember,
  SETTLED_FORECAST_CAPTURE_POLICY,
  SETTLED_FORECAST_OUTCOME_DEFINITION,
  type SettledForecastOutcome,
  savedOpenForecastMember,
} from "./settledForecastOutcomes";

const MAX_ROSTER = 1_000;
const MAX_EVENTS = 5_000;
const MAX_EVENT_BYTES = 8 * 1024 * 1024;
const MAX_WITNESS_BYTES = 64 * 1024;
const instant = z.iso.datetime({ precision: 6 });
const witness = z.string().max(MAX_WITNESS_BYTES).pipe(historyVisibilitySnapshot);
const xid = analyticsHistoryEvent.shape.transactionId;
declare const admittedForecast: unique symbol;

interface ServerPrincipal {
  actor: PermSetUser;
  session: NativeSessionRef;
}

/**
 * The existing custody trigger proves submitted members, not full roster selection.
 * A future trusted issuer must verify the original writer's complete, authorized roster
 * and preserve the independently observed pre-target commit proof on this installation.
 */
export interface AdmittedForecastOutcomeSource {
  readonly [admittedForecast]: true;
  readonly commit: PrivateForecastCommitProof;
  readonly settlementFence: string;
}

type Failure = {
  state: "unavailable";
  reason:
    | "forecast-unavailable"
    | "capture-unavailable"
    | "settlement-not-ready"
    | "settlement-coverage-unproven"
    | "roster-history-incomplete"
    | "source-unavailable";
};
type SettlementResult =
  | Failure
  | {
      state: "collected";
      definition: typeof SETTLED_FORECAST_OUTCOME_DEFINITION;
      capturePolicy: typeof SETTLED_FORECAST_CAPTURE_POLICY;
      forecastSnapshotId: string;
      currency: string;
      settlementFence: string;
      target: Pick<
        PrivateForecastCommitProof["target"],
        "from" | "toExclusive" | "calendar" | "timeZone"
      >;
      settledThrough: string;
      observedAt: string;
      observation: { snapshot: string; barrierXid: string };
      members: { dealId: string; incarnationId: string; outcome: SettledForecastOutcome }[];
    };

function unavailable(reason: Failure["reason"]): Failure {
  return { state: "unavailable", reason };
}

const nativeCutSchema = z.strictObject({
  snapshot: witness,
  observedAt: instant,
  complete: z.boolean(),
});
type NativeCut = z.output<typeof nativeCutSchema>;
const utcText = (value: SQL) => sql`public.analytics_history_utc(${value})`;

function boundedTimeout(value: number | undefined, max: number): boolean {
  return value !== undefined && Number.isInteger(value) && value > 0 && value <= max;
}

function validCutRequest({ commit, settlementFence }: AdmittedForecastOutcomeSource): boolean {
  return (
    z.literal(1).safeParse(commit.definitionVersion).success &&
    z.literal("independent-native-visibility-before-target").safeParse(commit.basis).success &&
    [
      commit.predictionCutoff,
      commit.insertedAt,
      commit.confirmedAt,
      commit.target.from,
      commit.target.toExclusive,
      settlementFence,
    ].every((value) => instant.safeParse(value).success) &&
    commit.predictionCutoff <= commit.insertedAt &&
    commit.insertedAt <= commit.confirmedAt &&
    commit.confirmedAt < commit.target.from &&
    commit.target.from < commit.target.toExclusive &&
    commit.target.toExclusive <= settlementFence &&
    witness.safeParse(commit.confirmationSnapshot).success &&
    witness.safeParse(commit.captureSnapshot).success &&
    xid.safeParse(commit.writerXid).success
  );
}

export async function markForecastSettlementBarrier(
  client: PoolClient,
  fence: string,
): Promise<string | null> {
  if (client.getTransactionStatus() !== "I") return null;
  // Autocommit assigns an XID after the wall-clock fence without changing application rows.
  // It must finish before establishing the independent RR observation.
  const result = await client.query<{ xid: unknown }>(
    `SELECT pg_catalog.pg_current_xact_id()::text AS xid
       WHERE pg_catalog.statement_timestamp() >= $1::pg_catalog.timestamptz
         AND NOT pg_catalog.pg_is_in_recovery()`,
    [fence],
  );
  const parsed = xid.safeParse(result.rows[0]?.xid);
  return parsed.success && client.getTransactionStatus() === "I" ? parsed.data : null;
}

export async function readForecastSettlementCut(
  tx: Db,
  barrier: string,
  fence: string,
): Promise<NativeCut | null> {
  // First data statement. A high XID can be excluded by xmax without being in xip.
  // Once the later committed barrier is visible, all older still-active XIDs must be in xip.
  const result = await tx.execute(sql`
    WITH observation AS MATERIALIZED (
      SELECT pg_catalog.pg_current_snapshot() AS snapshot, pg_catalog.clock_timestamp() AS sampled_at
      WHERE pg_catalog.current_setting('transaction_isolation') = 'repeatable read'
        AND pg_catalog.current_setting('transaction_read_only') = 'on'
        AND pg_catalog.pg_current_xact_id_if_assigned() IS NULL
        AND NOT pg_catalog.pg_is_in_recovery()
    )
    SELECT CASE WHEN pg_catalog.octet_length(o.snapshot::text) <= ${MAX_WITNESS_BYTES}
        THEN o.snapshot::text END AS snapshot,
      pg_catalog.to_char(o.sampled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        AS "observedAt",
      (pg_catalog.transaction_timestamp() >= ${fence}::timestamptz
        AND pg_catalog.transaction_timestamp() <= o.sampled_at
        AND pg_catalog.pg_snapshot_xmax(o.snapshot) > ${barrier}::pg_catalog.xid8
        AND pg_catalog.pg_visible_in_snapshot(${barrier}::pg_catalog.xid8, o.snapshot)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_snapshot_xip(o.snapshot) AS a(xid)
          WHERE a.xid <= ${barrier}::pg_catalog.xid8)) AS complete
    FROM observation o
  `);
  const parsed = nativeCutSchema.safeParse(result.rows[0]);
  return parsed.success ? parsed.data : null;
}

const rosterSchema = z.strictObject({
  scope: z.strictObject({ ownerId: historyUuid, pipelineId: historyUuid }),
  members: z.array(savedOpenForecastMember).max(MAX_ROSTER),
});

async function readSavedRoster(tx: Db, proof: PrivateForecastCommitProof) {
  // Digest the exact bytes used in the native receipt, then project only the open roster.
  // The UUID-select does not follow a successor or substitute the current open population.
  const result = await tx.execute(sql`
    WITH custody AS MATERIALIZED (
      SELECT s.scope, s.records, s.report_definition, s.forecast_request_bytes, s.forecast_payload_bytes
      FROM public.analytics_report_snapshots s
      WHERE s.id = ${proof.snapshotId}::uuid AND s.created_by = ${proof.creatorId}::uuid
        AND s.kind = 'forecast' AND s.definition_version = 1
        AND s.activation_id = ${proof.activationId}::uuid AND s.currency = ${proof.currency}
        AND s.forecast_request_key = ${proof.requestKey}::uuid
        AND s.forecast_writer_xid = ${proof.writerXid}::pg_catalog.xid8
        AND s.xmin = s.forecast_writer_xid::pg_catalog.xid
        AND s.xmin::text = ${proof.rowXmin}
        AND s.transaction_snapshot::text = ${proof.captureSnapshot}
        AND NOT pg_catalog.pg_visible_in_snapshot(s.forecast_writer_xid, s.transaction_snapshot)
        AND pg_catalog.pg_visible_in_snapshot(s.forecast_writer_xid,
          ${proof.confirmationSnapshot}::pg_catalog.pg_snapshot)
        AND s.cutoff_observed_at = ${proof.predictionCutoff}::timestamptz
        AND s.created_at = ${proof.insertedAt}::timestamptz
        AND s.forecast_target_start = ${proof.target.from}::timestamptz
        AND s.forecast_target_end = ${proof.target.toExclusive}::timestamptz
        AND s.target_from = ${proof.target.fromDate}::date
        AND s.target_to_exclusive = ${proof.target.toExclusiveDate}::date
        AND s.calendar = ${proof.target.calendar} AND s.time_zone = ${proof.target.timeZone}
        AND s.forecast_request_sha256 = pg_catalog.decode(${proof.requestSha256}, 'hex')
        AND s.forecast_payload_sha256 = pg_catalog.decode(${proof.payloadSha256}, 'hex')
        AND s.report_definition->>'outcomeDefinition' = ${SETTLED_FORECAST_OUTCOME_DEFINITION}
        AND s.report_definition->>'settlementPolicy' = ${SETTLED_FORECAST_CAPTURE_POLICY}
        AND pg_catalog.octet_length(s.forecast_request_bytes) BETWEEN 1 AND 65536
        AND pg_catalog.octet_length(s.forecast_payload_bytes) BETWEEN 1 AND 8388608
        AND pg_catalog.octet_length(s.scope::text) <= 512
        AND pg_catalog.jsonb_array_length(s.records) <= ${MAX_ROSTER}
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_trigger t
          WHERE t.tgrelid = 'public.analytics_report_snapshots'::regclass
            AND t.tgname = 'analytics_snapshots_z_forecast_custody'
            AND t.tgfoid = pg_catalog.to_regprocedure('public.analytics_guard_forecast_custody()')
            AND t.tgenabled = 'A' AND t.tgtype = 7 AND t.tgnargs = 0
            AND pg_catalog.pg_get_triggerdef(t.oid, false) LIKE
              '% FOR EACH ROW WHEN ((new.kind = ''forecast''::text)) EXECUTE FUNCTION %'
            AND NOT t.tgisinternal AND NOT t.tgdeferrable
        )
    ), verified AS MATERIALIZED (
      SELECT scope, records FROM custody c
      WHERE pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        'warpdrive-forecast-request-v1' || pg_catalog.chr(10) || c.forecast_request_bytes, 'UTF8'
      )), 'hex') = ${proof.requestSha256}
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          'warpdrive-forecast-payload-v1' || pg_catalog.chr(10) || c.forecast_payload_bytes, 'UTF8'
        )), 'hex') = ${proof.payloadSha256}
        AND c.forecast_payload_bytes::jsonb->'roster' = c.records
        AND c.forecast_request_bytes::jsonb->'scope' = c.scope
        AND c.forecast_request_bytes::jsonb->'reportDefinition' = c.report_definition
    )
    SELECT v.scope, (SELECT coalesce(jsonb_agg(r.member ORDER BY r.member->>'dealId'), '[]'::jsonb)
      FROM pg_catalog.jsonb_array_elements(v.records) r(member)
      WHERE r.member->>'status' = 'open') AS members
    FROM verified v
  `);
  const parsed = rosterSchema.safeParse(result.rows[0]);
  return parsed.success && parsed.data.scope.ownerId === proof.creatorId ? parsed.data : null;
}

const capturedRowSchema = z.strictObject({
  event: analyticsHistoryEvent,
  inPrediction: z.boolean(),
});

async function readSuffixes(
  tx: Db,
  actor: PermSetUser,
  proof: PrivateForecastCommitProof,
  roster: z.output<typeof rosterSchema>,
  cut: NativeCut,
) {
  const pipelineAuthority = visiblePipelinePredicate(actor) ?? sql`false`;
  const result = await tx.execute(sql`
    WITH roster AS MATERIALIZED (
      SELECT r."dealId" AS id, r."incarnationId" AS incarnation, r."tipOrdinal" AS anchor
      FROM pg_catalog.jsonb_to_recordset(${JSON.stringify(roster.members)}::jsonb) r(
        "dealId" uuid, "incarnationId" uuid, "tipOrdinal" bigint
      )
    ), observation AS MATERIALIZED (
      SELECT ${cut.snapshot}::pg_catalog.pg_snapshot AS current_cut,
        ${proof.captureSnapshot}::pg_catalog.pg_snapshot AS prediction_cut
    ), permitted_pipeline AS MATERIALIZED (
      SELECT pipelines.id FROM public.pipelines
      JOIN public.analytics_history_heads h ON h.entity_kind = 'pipeline' AND h.entity_id = pipelines.id
        AND h.activation_id = ${proof.activationId}::uuid AND h.active
      JOIN public.analytics_history_events tip ON tip.ordinal = h.last_event_ordinal
        AND tip.entity_kind = h.entity_kind AND tip.entity_id = h.entity_id
        AND tip.incarnation_id = h.incarnation_id AND tip.activation_id = h.activation_id
      CROSS JOIN observation o
      WHERE pipelines.id = ${roster.scope.pipelineId}::uuid AND NOT pipelines.is_archived
        AND ${pipelineAuthority} AND tip.after_state = public.analytics_project_pipeline(pipelines)
        AND pg_catalog.pg_visible_in_snapshot(tip.transaction_id::pg_catalog.xid8, o.current_cut)
        AND NOT EXISTS (
          SELECT 1 FROM public.analytics_history_events e
          WHERE e.entity_kind = 'pipeline' AND e.entity_id = pipelines.id AND e.activation_id = h.activation_id
            AND (e.incarnation_id <> h.incarnation_id OR e.ordinal > h.last_event_ordinal)
        )
    ), live AS MATERIALIZED (
      SELECT r.id, r.incarnation, r.anchor, h.last_event_ordinal
      FROM roster r
      JOIN public.deals d ON d.id = r.id
      JOIN permitted_pipeline p ON p.id = d.pipeline_id
      JOIN public.analytics_history_heads h ON h.entity_kind = 'deal' AND h.entity_id = r.id
        AND h.activation_id = ${proof.activationId}::uuid AND h.incarnation_id = r.incarnation AND h.active
      JOIN public.analytics_history_events tip ON tip.ordinal = h.last_event_ordinal
        AND tip.entity_kind = h.entity_kind AND tip.entity_id = h.entity_id
        AND tip.incarnation_id = h.incarnation_id AND tip.activation_id = h.activation_id
      CROSS JOIN observation o
      WHERE d.owner_id = ${actor.id}::uuid AND d.currency = ${proof.currency}
        AND d.archived_at IS NULL AND d.deleted_at IS NULL AND r.anchor <= h.last_event_ordinal
        AND tip.after_state = public.analytics_project_deal(d) AND tip.observed_at = h.last_observed_at
        AND pg_catalog.pg_visible_in_snapshot(tip.transaction_id::pg_catalog.xid8, o.current_cut)
        AND NOT EXISTS (
          SELECT 1 FROM public.analytics_history_events e
          WHERE e.entity_kind = 'deal' AND e.entity_id = r.id AND e.activation_id = h.activation_id
            AND e.ordinal > h.last_event_ordinal
        )
    ), selected AS MATERIALIZED (
      SELECT e.*, l.last_event_ordinal,
        pg_catalog.pg_visible_in_snapshot(e.transaction_id::pg_catalog.xid8, o.prediction_cut) AS in_prediction
      FROM live l
      JOIN public.analytics_history_events e ON e.entity_kind = 'deal' AND e.entity_id = l.id
        AND e.activation_id = ${proof.activationId}::uuid AND e.incarnation_id = l.incarnation
        AND e.ordinal >= l.anchor
      CROSS JOIN observation o
      WHERE pg_catalog.pg_visible_in_snapshot(e.transaction_id::pg_catalog.xid8, o.current_cut)
      LIMIT ${MAX_EVENTS + 1}
    ), health AS MATERIALIZED (
      SELECT EXISTS (SELECT 1 FROM permitted_pipeline)
        AND (SELECT count(*) FROM roster) = (SELECT count(*) FROM live)
        AND count(*) <= ${MAX_EVENTS}
        AND coalesce(sum(coalesce(octet_length(before_state::text), 0)
          + coalesce(octet_length(after_state::text), 0) + octet_length(observation_snapshot::text)
          + coalesce(octet_length(command_id), 0)), 0) <= ${MAX_EVENT_BYTES} AS complete
      FROM selected
    )
    SELECT CASE WHEN health.complete THEN (SELECT coalesce(json_agg(json_build_object(
      'tipOrdinal', e.last_event_ordinal::text, 'inPrediction', e.in_prediction,
      'event', json_build_object(
        'eventId', e.event_id, 'ordinal', e.ordinal::text, 'activationId', e.activation_id,
        'entityKind', e.entity_kind, 'entityId', e.entity_id, 'incarnationId', e.incarnation_id,
        'eventKind', e.event_kind, 'schemaVersion', e.schema_version, 'transactionId', e.transaction_id,
        'observationSnapshot', e.observation_snapshot::text, 'observedAt', ${utcText(sql`e.observed_at`)},
        'beforeState', e.before_state, 'afterState', e.after_state,
        'beforeWriteVersion', e.before_write_version, 'afterWriteVersion', e.after_write_version,
        'actorId', e.actor_id, 'commandId', e.command_id
      )) ORDER BY e.entity_id, e.ordinal), '[]'::json) FROM selected e) END AS rows
    FROM health
  `);
  const parsed = z
    .array(capturedRowSchema.extend({ tipOrdinal: z.string() }))
    .safeParse(result.rows[0]?.rows);
  return parsed.success ? parsed.data : null;
}

type SuffixRow = NonNullable<Awaited<ReturnType<typeof readSuffixes>>>[number];

function classifyRoster(
  rows: readonly SuffixRow[],
  members: readonly SavedOpenForecastMember[],
  fence: OutcomeFence,
) {
  const byDeal = new Map<string, SuffixRow[]>();
  for (const row of rows) {
    const group = byDeal.get(row.event.entityId);
    if (group === undefined) byDeal.set(row.event.entityId, [row]);
    else group.push(row);
  }
  if (byDeal.size !== members.length) return null;
  const settled: Extract<SettlementResult, { state: "collected" }>["members"] = [];
  for (const { dealId, incarnationId, ...fact } of members) {
    const group = byDeal.get(dealId);
    const last = group?.at(-1);
    if (group === undefined || last === undefined || last.event.ordinal !== last.tipOrdinal)
      return null;
    const outcome = classifySettledForecastOutcome(
      group,
      { dealId, incarnationId, ...fact },
      fence,
    );
    if (outcome === null) return null;
    settled.push({ dealId, incarnationId, outcome });
  }
  return settled;
}

async function collectInSnapshot(
  tx: Db,
  principal: ServerPrincipal,
  { commit, settlementFence }: AdmittedForecastOutcomeSource,
  barrier: string,
  signal: AbortSignal,
): Promise<SettlementResult> {
  await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
  await tx.execute(sql`SET LOCAL lock_timeout = '2000ms'`);
  await tx.execute(sql`SET LOCAL search_path = pg_catalog, public, pg_temp`);
  const cut = await readForecastSettlementCut(tx, barrier, settlementFence);
  if (cut === null || !cut.complete) return unavailable("settlement-coverage-unproven");
  const live = await currentNativeReadActor(tx, principal.session, signal);
  const actor = restrictReportActor(principal.actor, live?.actor ?? null);
  if (actor === null || actor.groupIds.size > MAX_ROSTER)
    return unavailable("forecast-unavailable");
  const installation = await readHistoryInstallation(tx, signal);
  if (
    installation.state !== "installed" ||
    installation.activation.activationId !== commit.activationId ||
    installation.activation.activatedAt > commit.predictionCutoff
  )
    return unavailable("capture-unavailable");
  const roster = await readSavedRoster(tx, commit);
  if (roster === null) return unavailable("forecast-unavailable");
  signal.throwIfAborted();
  const rows = await readSuffixes(tx, actor, commit, roster, cut);
  if (rows === null) return unavailable("roster-history-incomplete");
  const { from, toExclusive, calendar, timeZone } = commit.target;
  const members = classifyRoster(rows, roster.members, {
    from,
    toExclusive,
    observedAt: cut.observedAt,
    predictionCutoff: commit.predictionCutoff,
    activationId: commit.activationId,
    ownerId: actor.id,
    pipelineId: roster.scope.pipelineId,
    currency: commit.currency,
  });
  if (members === null) return unavailable("roster-history-incomplete");
  if ((await currentNativeReadActor(tx, principal.session, signal)) === null)
    return unavailable("forecast-unavailable");
  return {
    state: "collected",
    definition: SETTLED_FORECAST_OUTCOME_DEFINITION,
    capturePolicy: SETTLED_FORECAST_CAPTURE_POLICY,
    forecastSnapshotId: commit.snapshotId,
    currency: commit.currency,
    settlementFence,
    target: { from, toExclusive, calendar, timeZone },
    settledThrough: toExclusive,
    observedAt: cut.observedAt,
    observation: { snapshot: cut.snapshot, barrierXid: barrier },
    members,
  };
}

async function collectOnFreshClient(
  pool: Pool,
  principal: ServerPrincipal,
  source: AdmittedForecastOutcomeSource,
  signal: AbortSignal,
): Promise<SettlementResult> {
  const client = await pool.connect();
  let reusable = false;
  try {
    signal.throwIfAborted();
    if (client.getTransactionStatus() !== "I") return unavailable("source-unavailable");
    const barrier = await markForecastSettlementBarrier(client, source.settlementFence);
    if (barrier === null) {
      reusable = client.getTransactionStatus() === "I";
      return unavailable("settlement-not-ready");
    }
    signal.throwIfAborted();
    const result = await drizzle(client, { schema }).transaction(
      (tx) => collectInSnapshot(tx, principal, source, barrier, signal),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    reusable = client.getTransactionStatus() === "I";
    signal.throwIfAborted();
    return reusable ? result : unavailable("source-unavailable");
  } finally {
    client.release(!reusable);
  }
}

/** Internal collector. Only a trusted issuer may supply the qualified roster/receipt input. */
export async function collectSettledForecastOutcomes(
  pool: Pool,
  principal: ServerPrincipal,
  source: AdmittedForecastOutcomeSource,
  signal: AbortSignal,
): Promise<SettlementResult> {
  signal.throwIfAborted();
  if (
    !principal.actor.isActive ||
    principal.actor.id !== principal.session.userId ||
    principal.actor.id !== source.commit.creatorId ||
    !validCutRequest(source)
  )
    return unavailable("forecast-unavailable");
  if (
    !boundedTimeout(pool.options.connectionTimeoutMillis, 5_000) ||
    !boundedTimeout(pool.options.query_timeout, 10_000)
  )
    return unavailable("source-unavailable");
  try {
    return await collectOnFreshClient(pool, principal, source, signal);
  } catch {
    signal.throwIfAborted();
    return unavailable("source-unavailable");
  }
}
