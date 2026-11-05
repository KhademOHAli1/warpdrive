import { eq, type SQL, sql } from "drizzle-orm";
import { Pool } from "pg";
import { z } from "zod";
import type { Db } from "@/db/client";
import { teamMembers } from "@/db/schema";
import { currencyCode } from "@/features/currencies/currencySchema";
import { dealVisibilityClause } from "@/features/deals/visibility";
import { isTimeZone } from "@/features/i18n/preferences";
import type { PermSetUser } from "@/features/permissions/effective";
import { buildUuidArray } from "@/features/permissions/sql";
import { onlyOwners, resolveOwnerIds } from "@/features/stats/ownerIds";
import { ownerScope } from "@/features/stats/ownerScope";
import { hydrateActor } from "@/server/hydrateActor";
import type { OwnerIdFilter, OwnerScope } from "@/types/stats";
import { historyUuid, historyVisibilitySnapshot } from "./contracts";
import { verifyInventoryBoundaryEvidence } from "./inventoryBoundaryEvidence";
import {
  type InventoryMovementResult,
  MAX_INVENTORY_KEYS,
  reconcileInventoryMovement,
} from "./inventoryMovement";
import {
  type CapturedBoundary,
  type CurrentInventoryRef,
  corpusRowSchema,
  prepareMovementEvidence,
} from "./inventoryMovementEvidenceSource";
import {
  INVENTORY_SNAPSHOT_DEFINITION,
  INVENTORY_SNAPSHOT_DEFINITION_VERSION,
} from "./inventorySnapshotDefinition";
import { type HistoryInstallation, readHistoryInstallation } from "./repository";

const MAX_CORPUS_EVENTS = 12_000;
const MAX_CORPUS_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_NATIVE_CUT_BYTES = 64 * 1024;
const uuid = historyUuid.transform((id) => id.toLowerCase());
const requestSchema = z.strictObject({ openingSnapshotId: uuid, closingSnapshotId: uuid });
const pinnedOwnerSelection = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("me") }),
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("user"), userId: uuid }),
  z.strictObject({ kind: z.literal("team"), teamId: uuid }),
]);
const pinnedOwners = z.union([
  z.strictObject({ everyone: z.literal(true) }),
  z.strictObject({
    everyone: z.literal(false),
    ids: z
      .array(uuid)
      .max(MAX_INVENTORY_KEYS)
      .refine((ids) => new Set(ids).size === ids.length),
  }),
]);
const persistedBoundary = z.strictObject({
  snapshotId: uuid,
  observedAt: z
    .string()
    .datetime()
    .regex(/\.\d{6}Z$/),
  transactionSnapshot: historyVisibilitySnapshot,
  activationId: uuid,
  currency: z.string().regex(/^[A-Z]{3}$/),
  calendar: z.enum(["gregory", "persian"]),
  timeZone: z.string().min(1).max(100).refine(isTimeZone),
  scope: z.strictObject({
    pipelineId: uuid.nullable(),
    ownerScope: pinnedOwnerSelection,
    owners: pinnedOwners,
  }),
  records: z.array(z.unknown()).max(MAX_INVENTORY_KEYS),
});

export type InventoryMovementRequest = z.input<typeof requestSchema>;
type Request = z.output<typeof requestSchema>;
type Snapshot = z.output<typeof persistedBoundary>;
type CorpusRow = z.output<typeof corpusRowSchema>;
type Movement = Extract<InventoryMovementResult, { ok: true }>;
type ReadFailureReason =
  | "invalid-request"
  | "snapshot-transaction-unavailable"
  | "snapshot-unavailable"
  | "snapshot-incompatible"
  | "snapshot-order-unproven"
  | "snapshot-boundary-unproven"
  | "history-coverage-unavailable"
  | "history-permission-limited"
  | "retained-history-authority-unavailable"
  | "unmodeled-membership-change"
  | "history-limit"
  | "history-incomplete"
  | "reconciliation-failed"
  | "movement-read-failed";

type Failure = { state: "unavailable"; reason: ReadFailureReason };
export type InventoryMovementRead =
  | Exclude<HistoryInstallation, { state: "installed" }>
  | Failure
  | {
      state: "available";
      basis: "current-authorized-pinned-inventory";
      opening: { snapshotId: string; observedAt: string };
      closing: { snapshotId: string; observedAt: string };
      timeZone: string;
      calendar: "gregory" | "persian";
      result: Movement;
    };

function unavailable(reason: ReadFailureReason): Failure {
  return { state: "unavailable", reason };
}

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

interface SnapshotPair {
  opening: Snapshot;
  closing: Snapshot;
}

async function readSnapshots(
  tx: Db,
  actorId: string,
  request: Request,
  signal: AbortSignal,
): Promise<SnapshotPair | Failure> {
  const result = await tx.execute(sql`
    SELECT s.id::text AS "snapshotId", s.activation_id::text AS "activationId",
      ${utcText(sql`s.cutoff_observed_at`)} AS "observedAt",
      CASE WHEN octet_length(s.transaction_snapshot::text) <= ${MAX_NATIVE_CUT_BYTES}
        THEN s.transaction_snapshot::text END AS "transactionSnapshot",
      s.currency, s.calendar, s.time_zone AS "timeZone",
      CASE WHEN octet_length(s.scope::text) <= ${MAX_SNAPSHOT_BYTES} THEN s.scope END AS scope,
      CASE WHEN jsonb_array_length(s.records) <= ${MAX_INVENTORY_KEYS}
        AND octet_length(s.records::text) <= ${MAX_SNAPSHOT_BYTES}
        THEN s.records END AS records,
      (s.definition_version = ${INVENTORY_SNAPSHOT_DEFINITION_VERSION}
        AND s.report_definition = ${JSON.stringify(INVENTORY_SNAPSHOT_DEFINITION)}::jsonb
        AND s.model_version IS NULL AND s.model_definition IS NULL
        AND s.event_high_water_ordinal IS NULL
        AND s.target_from IS NULL AND s.target_to_exclusive IS NULL) AS "writerDefinitionMatches"
    FROM public.analytics_report_snapshots s
    WHERE s.created_by = ${actorId}::uuid AND s.kind = 'pipeline-inventory'
      AND s.id IN (${request.openingSnapshotId}::uuid, ${request.closingSnapshotId}::uuid)
  `);
  signal.throwIfAborted();
  if (result.rows.length !== 2) return unavailable("snapshot-unavailable");
  const byId = new Map<string, Snapshot>();
  for (const row of result.rows) {
    const { writerDefinitionMatches, ...candidate } = row;
    const parsed = persistedBoundary.safeParse(candidate);
    if (writerDefinitionMatches !== true || !parsed.success)
      return unavailable("snapshot-boundary-unproven");
    const supported = currencyCode.safeParse(parsed.data.currency);
    if (!supported.success || supported.data !== parsed.data.currency)
      return unavailable("snapshot-incompatible");
    byId.set(parsed.data.snapshotId, parsed.data);
  }
  const opening = byId.get(request.openingSnapshotId);
  const closing = byId.get(request.closingSnapshotId);
  return opening === undefined || closing === undefined
    ? unavailable("snapshot-unavailable")
    : { opening, closing };
}

function sameOwners(left: OwnerIdFilter, right: OwnerIdFilter) {
  if (left.everyone || right.everyone) return left.everyone === right.everyone;
  if (left.ids.length !== right.ids.length) return false;
  const ids = new Set(left.ids);
  return right.ids.every((id) => ids.has(id));
}

function compatibleSnapshots({ opening, closing }: SnapshotPair): boolean {
  return (
    opening.activationId === closing.activationId &&
    opening.currency === closing.currency &&
    opening.calendar === closing.calendar &&
    opening.timeZone === closing.timeZone &&
    opening.scope.pipelineId === closing.scope.pipelineId &&
    JSON.stringify(opening.scope.ownerScope) === JSON.stringify(closing.scope.ownerScope) &&
    sameOwners(opening.scope.owners, closing.scope.owners)
  );
}

async function resolveBoundedOwners(
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
    .limit(MAX_INVENTORY_KEYS + 1);
  signal.throwIfAborted();
  return members.length > MAX_INVENTORY_KEYS
    ? null
    : onlyOwners(members.map(({ userId }) => userId));
}

async function validateScope(
  tx: Db,
  actor: PermSetUser,
  snapshot: Snapshot,
  signal: AbortSignal,
): Promise<Failure | null> {
  const requested = snapshot.scope.ownerScope;
  const current = ownerScope(actor, requested);
  if (JSON.stringify(current) !== JSON.stringify(requested))
    return unavailable("history-permission-limited");
  const owners = await resolveBoundedOwners(tx, actor, current, signal);
  if (owners === null) return unavailable("history-limit");
  return sameOwners(snapshot.scope.owners, owners) ? null : unavailable("snapshot-incompatible");
}

async function orderedNativeCuts(
  tx: Db,
  { opening, closing }: SnapshotPair,
  activatedAt: string,
  signal: AbortSignal,
) {
  const result = await tx.execute(sql`
    WITH cuts AS MATERIALIZED (
      SELECT ${opening.transactionSnapshot}::pg_catalog.pg_snapshot AS opening,
        ${closing.transactionSnapshot}::pg_catalog.pg_snapshot AS closing,
        pg_catalog.pg_current_snapshot() AS current_snapshot
    )
    SELECT
      ${opening.observedAt}::timestamptz >= ${activatedAt}::timestamptz
      AND ${opening.observedAt}::timestamptz < ${closing.observedAt}::timestamptz
      AND ${closing.observedAt}::timestamptz <= pg_catalog.clock_timestamp()
      AND pg_catalog.pg_visible_in_snapshot(
        coverage.activation_transaction_id::pg_catalog.xid8, cuts.opening
      )
      AND pg_catalog.pg_visible_in_snapshot(
        coverage.activation_transaction_id::pg_catalog.xid8, cuts.closing
      )
      AND pg_catalog.pg_snapshot_xmax(cuts.opening) <= pg_catalog.pg_snapshot_xmax(cuts.closing)
      AND pg_catalog.pg_snapshot_xmax(cuts.closing) <= pg_catalog.pg_snapshot_xmax(cuts.current_snapshot)
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_snapshot_xip(cuts.closing) AS active(xid)
        WHERE pg_catalog.pg_visible_in_snapshot(active.xid, cuts.opening)
      )
      AND CASE WHEN octet_length(cuts.current_snapshot::text) <= ${MAX_NATIVE_CUT_BYTES}
        THEN NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_snapshot_xip(cuts.current_snapshot) AS active(xid)
          WHERE pg_catalog.pg_visible_in_snapshot(active.xid, cuts.closing)
        ) ELSE false END AS ordered
    FROM cuts CROSS JOIN public.analytics_history_coverage coverage
    WHERE coverage.id = true AND coverage.activation_id = ${opening.activationId}::uuid
  `);
  signal.throwIfAborted();
  return result.rows[0]?.ordered === true;
}

async function readCorpus(
  tx: Db,
  { opening, closing }: SnapshotPair,
  signal: AbortSignal,
): Promise<CorpusRow[] | Failure> {
  signal.throwIfAborted();
  const result = await tx.execute(sql`
    WITH corpus AS MATERIALIZED (
      SELECT e.* FROM public.analytics_history_events e
      WHERE e.activation_id = ${opening.activationId}::uuid
        AND pg_catalog.pg_visible_in_snapshot(e.transaction_id::pg_catalog.xid8,
          ${closing.transactionSnapshot}::pg_catalog.pg_snapshot)
      ORDER BY e.ordinal LIMIT ${MAX_CORPUS_EVENTS + 1}
    ), budget AS MATERIALIZED (
      SELECT count(*) > ${MAX_CORPUS_EVENTS} OR coalesce(sum(
        coalesce(octet_length(before_state::text), 0)::bigint
        + coalesce(octet_length(after_state::text), 0)
        + octet_length(observation_snapshot::text) + coalesce(octet_length(command_id), 0)
      ), 0) > ${MAX_CORPUS_BYTES} AS exceeded
      FROM corpus
    ), baseline_status AS MATERIALIZED (
      SELECT count(*) FILTER (WHERE e.entity_kind = 'deal') = c.baseline_deal_count
        AND count(*) FILTER (WHERE e.entity_kind = 'stage') = c.baseline_stage_count
        AND count(*) FILTER (WHERE e.entity_kind = 'pipeline') = c.baseline_pipeline_count
        AND coalesce(bool_and(e.transaction_id = c.activation_transaction_id), true) AS qualified
      FROM public.analytics_history_coverage c
      LEFT JOIN corpus e ON e.event_kind = 'baseline'
      WHERE c.id = true AND c.activation_id = ${opening.activationId}::uuid
      GROUP BY c.baseline_deal_count, c.baseline_stage_count, c.baseline_pipeline_count
    ), membership AS MATERIALIZED (
      SELECT e.*,
        pg_catalog.pg_visible_in_snapshot(e.transaction_id::pg_catalog.xid8,
          ${opening.transactionSnapshot}::pg_catalog.pg_snapshot) AS in_opening,
        true AS in_closing
      FROM corpus e
      WHERE NOT (SELECT exceeded FROM budget) AND (SELECT qualified FROM baseline_status)
    ), selected AS MATERIALIZED (
      SELECT m.*,
        max(m.ordinal) FILTER (WHERE m.in_opening) OVER by_incarnation AS opening_tip,
        max(m.ordinal) FILTER (WHERE m.in_closing) OVER by_incarnation AS closing_tip,
        min(m.ordinal) FILTER (WHERE m.in_closing) OVER by_incarnation AS closing_origin
      FROM membership m
      WINDOW by_incarnation AS (PARTITION BY m.entity_kind, m.entity_id, m.incarnation_id)
    )
    SELECT exceeded, (SELECT qualified FROM baseline_status) AS "baselineQualified",
      CASE WHEN exceeded THEN '[]'::json ELSE (
      SELECT coalesce(json_agg(json_build_object(
        'inOpening', e.in_opening, 'inClosing', e.in_closing,
        'openingTip', coalesce(e.ordinal = e.opening_tip, false),
        'closingTip', coalesce(e.ordinal = e.closing_tip, false),
        'closingOrigin', coalesce(e.ordinal = e.closing_origin, false),
        'event', json_build_object(
          'eventId', e.event_id, 'ordinal', e.ordinal::text, 'activationId', e.activation_id,
          'entityKind', e.entity_kind, 'entityId', e.entity_id, 'incarnationId', e.incarnation_id,
          'eventKind', e.event_kind, 'schemaVersion', e.schema_version, 'transactionId', e.transaction_id,
          'observationSnapshot', e.observation_snapshot::text, 'observedAt', ${utcText(sql`e.observed_at`)},
          'beforeState', e.before_state, 'afterState', e.after_state,
          'beforeWriteVersion', e.before_write_version, 'afterWriteVersion', e.after_write_version,
          'actorId', e.actor_id, 'commandId', e.command_id
        )
      ) ORDER BY e.ordinal), '[]'::json) FROM selected e
    ) END AS rows FROM budget
  `);
  signal.throwIfAborted();
  const row = result.rows[0];
  if (row?.exceeded === true) return unavailable("history-limit");
  if (
    row?.baselineQualified !== true ||
    !Array.isArray(row.rows) ||
    row.rows.length > MAX_CORPUS_EVENTS
  )
    return unavailable("history-incomplete");

  const events: CorpusRow[] = [];
  for (const event of row.rows) {
    const parsed = corpusRowSchema.safeParse(event);
    if (!parsed.success) return unavailable("history-incomplete");
    events.push(parsed.data);
  }
  return events;
}

function currentPipelineGate(actor: PermSetUser, group: SQL) {
  if (actor.type === "admin") return sql`true`;
  const groups = buildUuidArray([...actor.groupIds]);
  return sql`(${group} IS NULL OR ${group} = ANY(${groups}))`;
}

async function verifyCurrentReferences(
  tx: Db,
  actor: PermSetUser,
  activationId: string,
  refs: CurrentInventoryRef[],
  signal: AbortSignal,
): Promise<Failure | null> {
  const visible = dealVisibilityClause({
    userId: actor.id,
    isAdmin: actor.type === "admin",
    isActive: actor.isActive,
    sessionLive: true,
    visibilityGroupIds: [...actor.groupIds],
    managedUserIds: [...(actor.managedUserIds ?? [])],
  });
  const pipelineGate = currentPipelineGate(actor, sql`p.visibility_group_id`);
  const result = await tx.execute(sql`
    WITH refs AS MATERIALIZED (
      SELECT r.kind, r."entityId" AS id, r."incarnationId" AS incarnation_id
      FROM jsonb_to_recordset(${JSON.stringify(refs)}::jsonb)
        AS r(kind text, "entityId" uuid, "incarnationId" uuid)
    ), projected AS MATERIALIZED (
      SELECT r.kind, r.id, r.incarnation_id, public.analytics_project_deal(d) AS state
      FROM refs r JOIN public.deals d ON r.kind = 'deal' AND r.id = d.id
      JOIN public.pipelines p ON p.id = d.pipeline_id
      WHERE d.archived_at IS NULL AND d.deleted_at IS NULL AND NOT p.is_archived AND ${visible}
      UNION ALL
      SELECT r.kind, r.id, r.incarnation_id, public.analytics_project_pipeline(p)
      FROM refs r JOIN public.pipelines p ON r.kind = 'pipeline' AND r.id = p.id
      WHERE NOT p.is_archived AND ${pipelineGate}
      UNION ALL
      SELECT r.kind, r.id, r.incarnation_id, public.analytics_project_stage(s)
      FROM refs r JOIN public.stages s ON r.kind = 'stage' AND r.id = s.id
      JOIN public.pipelines p ON p.id = s.pipeline_id
      WHERE NOT p.is_archived AND ${pipelineGate}
    ), matched AS MATERIALIZED (
      SELECT r.kind, r.id
      FROM projected r
      JOIN public.analytics_history_heads h ON h.entity_kind = r.kind AND h.entity_id = r.id
        AND h.active AND h.activation_id = ${activationId}::uuid AND h.incarnation_id = r.incarnation_id
      JOIN public.analytics_history_events tip ON tip.ordinal = h.last_event_ordinal
        AND tip.entity_kind = r.kind AND tip.entity_id = r.id
        AND tip.activation_id = h.activation_id AND tip.incarnation_id = h.incarnation_id
      WHERE tip.after_state = r.state
        AND pg_catalog.pg_visible_in_snapshot(tip.transaction_id::pg_catalog.xid8, pg_catalog.pg_current_snapshot())
        AND NOT EXISTS (
          SELECT 1 FROM public.analytics_history_events later
          WHERE later.entity_kind = h.entity_kind AND later.entity_id = h.entity_id
            AND later.activation_id = h.activation_id AND later.ordinal > h.last_event_ordinal
        )
    )
    SELECT EXISTS (
      SELECT 1 FROM refs r LEFT JOIN public.deals d ON d.id = r.id
      WHERE r.kind = 'deal' AND (d.id IS NULL OR d.archived_at IS NOT NULL OR d.deleted_at IS NOT NULL)
    ) AS retained,
      (SELECT count(*) FROM matched) = (SELECT count(*) FROM refs) AS qualified
  `);
  signal.throwIfAborted();
  const row = result.rows[0];
  if (row?.retained === true) return unavailable("retained-history-authority-unavailable");
  return row?.qualified === true ? null : unavailable("history-permission-limited");
}

function boundaryForEvidence(snapshot: Snapshot): CapturedBoundary {
  const { snapshotId, observedAt, activationId, currency, records } = snapshot;
  const { pipelineId, owners } = snapshot.scope;
  return { snapshotId, observedAt, activationId, currency, scope: { pipelineId, owners }, records };
}

type EvidenceFailure = Extract<
  ReturnType<typeof verifyInventoryBoundaryEvidence>,
  { state: "unavailable" }
>;

function evidenceFailure({ reason }: EvidenceFailure): Failure {
  switch (reason) {
    case "bounded-limit":
      return unavailable("history-limit");
    case "cut-order-unproven":
      return unavailable("snapshot-order-unproven");
    case "boundary-selection-mismatch":
    case "boundary-book-mismatch":
      return unavailable("snapshot-boundary-unproven");
    case "snapshot-incompatible":
    case "history-permission-limited":
    case "retained-history-authority-unavailable":
    case "unmodeled-membership-change":
      return unavailable(reason);
    default:
      return unavailable("history-incomplete");
  }
}

async function reconcileSnapshotPair(
  tx: Db,
  actor: PermSetUser,
  pair: SnapshotPair,
  signal: AbortSignal,
): Promise<InventoryMovementRead> {
  const corpus = await readCorpus(tx, pair, signal);
  if (!Array.isArray(corpus)) return corpus;
  const { opening, closing } = pair;
  const prepared = prepareMovementEvidence(
    corpus,
    boundaryForEvidence(opening),
    boundaryForEvidence(closing),
    actor,
  );
  if (prepared.state === "unavailable") return prepared;
  const failure = await verifyCurrentReferences(
    tx,
    actor,
    opening.activationId,
    prepared.currentRefs,
    signal,
  );
  if (failure !== null) return failure;
  const proof = verifyInventoryBoundaryEvidence({
    ...prepared.evidence,
    proof: {
      completeness: "complete",
      cutOrder: "native-ordered",
      authority: "current-live-authorized",
      membershipDrivers: "qualified",
    },
  });
  if (proof.state === "unavailable") return evidenceFailure(proof);
  const result = reconcileInventoryMovement(proof.movement);
  if (!result.ok) return unavailable("reconciliation-failed");
  return {
    state: "available",
    basis: "current-authorized-pinned-inventory",
    opening: { snapshotId: opening.snapshotId, observedAt: opening.observedAt },
    closing: { snapshotId: closing.snapshotId, observedAt: closing.observedAt },
    timeZone: opening.timeZone,
    calendar: opening.calendar,
    result,
  };
}

async function readInSnapshot(
  tx: Db,
  requestActor: PermSetUser,
  request: Request,
  signal: AbortSignal,
): Promise<InventoryMovementRead> {
  const actor = await currentActor(tx, requestActor, signal);
  if (actor === null) return unavailable("snapshot-unavailable");
  if (
    actor.groupIds.size > MAX_INVENTORY_KEYS ||
    (actor.managedUserIds?.size ?? 0) > MAX_INVENTORY_KEYS
  )
    return unavailable("history-limit");
  const installation = await readHistoryInstallation(tx, signal);
  if (installation.state !== "installed") return installation;
  const pair = await readSnapshots(tx, actor.id, request, signal);
  if ("state" in pair) return pair;
  if (!compatibleSnapshots(pair)) return unavailable("snapshot-incompatible");
  if (pair.opening.activationId !== installation.activation.activationId)
    return unavailable("history-coverage-unavailable");
  const scopeFailure = await validateScope(tx, actor, pair.opening, signal);
  if (scopeFailure !== null) return scopeFailure;
  if (!(await orderedNativeCuts(tx, pair, installation.activation.activatedAt, signal)))
    return unavailable("snapshot-order-unproven");
  return reconcileSnapshotPair(tx, actor, pair, signal);
}

/**
 * Internal creator-only comparison. This uses a constant current authorization ceiling,
 * requires complete bounded capture, and trusts the qualified writer/activation lineage.
 * Installed use requires writer-only cut provenance. The global metadata preflight can
 * affect availability for unrelated scopes, so this service is not a public boundary.
 */
export async function readInventoryMovementBetweenSnapshots(
  db: Db,
  actor: PermSetUser,
  input: InventoryMovementRequest,
  signal: AbortSignal,
): Promise<InventoryMovementRead> {
  signal.throwIfAborted();
  const request = requestSchema.safeParse(input);
  if (!request.success || request.data.openingSnapshotId === request.data.closingSnapshotId)
    return unavailable("invalid-request");
  if (!("$client" in db) || !(db.$client instanceof Pool))
    return unavailable("snapshot-transaction-unavailable");

  try {
    return await db.transaction(
      async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
        await tx.execute(sql`SET LOCAL lock_timeout = '2000ms'`);
        const result = await readInSnapshot(tx, actor, request.data, signal);
        signal.throwIfAborted();
        return result;
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return unavailable("movement-read-failed");
  }
}
