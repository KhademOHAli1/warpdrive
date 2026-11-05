import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { z } from "zod";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import type { DashboardFilters } from "@/types/stats";
import { type AnalyticsHistoryEvent, historyUuid } from "./contracts";
import { type CurrentDealHistory, readCurrentDealHistory } from "./repository";
import {
  MAX_STAGE_DEFINITION_EVENTS,
  type StageDefinition,
  type StageDefinitionScope,
  type StageDefinitionSelection,
  selectStageDefinition,
} from "./stageDefinitions";

const canonicalUuid = historyUuid.transform((id) => id.toLowerCase());
const requestSchema = z.strictObject({
  dealId: canonicalUuid,
  anchorEventId: canonicalUuid,
  side: z.enum(["before", "after"]),
  ownTransactionPolicy: z.enum(["include-final-own-transaction", "exclude-own-transaction"]),
});
const stageReference = z.object({ stageId: canonicalUuid, pipelineId: canonicalUuid });

export type StageDefinitionRequest = z.input<typeof requestSchema>;
type StageReference = z.output<typeof stageReference>;
type OwnTransactionPolicy = StageDefinitionScope["ownTransactionPolicy"];
type SelectedDefinition = Extract<StageDefinitionSelection, { ok: true }>;
type VersionWitness = Pick<
  SelectedDefinition["source"],
  "firstOrdinal" | "lastOrdinal" | "membership"
> &
  Pick<SelectedDefinition, "activationId" | "incarnationId">;

export type CurrentDealStageDefinition =
  | Exclude<CurrentDealHistory, { state: "available" | "partial" }>
  | {
      state: "unavailable";
      reason:
        | "invalid-definition-request"
        | "definition-read-failed"
        | "history-limit"
        | "anchor-unavailable"
        | "stage-definition-unavailable"
        | "stage-definition-limit";
    }
  | { state: "available"; stageId: string; definition: StageDefinition; version: VersionWitness };

interface StageObservation {
  incarnationId: string | null;
  ambiguousOwnReplacement: boolean;
  events: unknown[];
}

// Recheck durable authority in the same observation. Preserve the authenticated request's
// existing ceiling if a grant appears between request hydration and this read.
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

async function readStageObservation(
  tx: Db,
  anchor: AnalyticsHistoryEvent,
  stage: StageReference,
  policy: OwnTransactionPolicy,
  signal: AbortSignal,
): Promise<StageObservation | undefined> {
  signal.throwIfAborted();
  const includeOwn = policy === "include-final-own-transaction";
  // The deal reader has already authorized this parent in the same database snapshot. Check
  // its live stage and capture tip here, then read anchor membership across every incarnation.
  const result = await tx.execute(sql`
    WITH authorized_stage AS MATERIALIZED (
      SELECT s.id, h.incarnation_id
      FROM public.stages s
      JOIN public.analytics_history_heads h ON h.entity_kind = 'stage'
        AND h.entity_id = s.id AND h.active = true
        AND h.activation_id = ${anchor.activationId}::uuid
      JOIN public.analytics_history_events tip ON tip.ordinal = h.last_event_ordinal
        AND tip.entity_kind = 'stage' AND tip.entity_id = s.id
        AND tip.incarnation_id = h.incarnation_id AND tip.activation_id = h.activation_id
      WHERE s.id = ${stage.stageId}::uuid AND s.pipeline_id = ${stage.pipelineId}::uuid
        AND tip.after_state = public.analytics_project_stage(s)
        AND NOT EXISTS (
          SELECT 1 FROM public.analytics_history_events later
          WHERE later.entity_kind = 'stage' AND later.entity_id = s.id
            AND later.activation_id = h.activation_id AND later.ordinal > h.last_event_ordinal
        )
    ), anchor_events AS MATERIALIZED (
      SELECT e.* FROM public.analytics_history_events e
      JOIN authorized_stage s ON s.id = e.entity_id
      WHERE e.entity_kind = 'stage' AND e.activation_id = ${anchor.activationId}::uuid
        AND CASE WHEN e.transaction_id = ${anchor.transactionId} THEN ${includeOwn}::boolean
          ELSE pg_catalog.pg_visible_in_snapshot(
            e.transaction_id::pg_catalog.xid8, ${anchor.observationSnapshot}::pg_catalog.pg_snapshot
          )
        END
      ORDER BY e.ordinal ASC LIMIT ${MAX_STAGE_DEFINITION_EVENTS + 1}
    )
    SELECT (SELECT incarnation_id::text FROM authorized_stage) AS "incarnationId",
      EXISTS (
        SELECT 1 FROM anchor_events origin JOIN authorized_stage s
          ON s.incarnation_id = origin.incarnation_id
        WHERE origin.transaction_id = ${anchor.transactionId} AND origin.event_kind = 'insert'
          AND EXISTS (
            SELECT 1 FROM public.analytics_history_events previous
            WHERE previous.entity_kind = 'stage' AND previous.entity_id = s.id
              AND previous.activation_id = origin.activation_id
              AND previous.incarnation_id <> s.incarnation_id
          )
      ) AS "ambiguousOwnReplacement",
      (SELECT coalesce(json_agg(json_build_object(
        'eventId', e.event_id, 'ordinal', e.ordinal::text, 'activationId', e.activation_id,
        'entityKind', e.entity_kind, 'entityId', e.entity_id, 'incarnationId', e.incarnation_id,
        'eventKind', e.event_kind, 'schemaVersion', e.schema_version,
        'transactionId', e.transaction_id, 'observationSnapshot', e.observation_snapshot::text,
        'observedAt', to_char(e.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'beforeState', e.before_state, 'afterState', e.after_state,
        'beforeWriteVersion', e.before_write_version, 'afterWriteVersion', e.after_write_version,
        'actorId', e.actor_id, 'commandId', e.command_id
      ) ORDER BY e.ordinal), '[]'::json) FROM anchor_events e) AS events
  `);
  signal.throwIfAborted();
  return (result as unknown as { rows: StageObservation[] }).rows[0];
}

function selectObservation(
  observation: StageObservation | undefined,
  anchor: AnalyticsHistoryEvent,
  stage: StageReference,
  policy: OwnTransactionPolicy,
): CurrentDealStageDefinition {
  if (observation === undefined) return { state: "unavailable", reason: "definition-read-failed" };
  if (observation.events.length > MAX_STAGE_DEFINITION_EVENTS)
    return { state: "unavailable", reason: "stage-definition-limit" };
  // The raw deal side references a UUID, so a replacement created in the anchor transaction
  // cannot safely stand in for the incarnation that the deal side referenced.
  if (observation.incarnationId === null || observation.ambiguousOwnReplacement)
    return { state: "unavailable", reason: "stage-definition-unavailable" };
  const selected = selectStageDefinition(observation.events, {
    activationId: anchor.activationId,
    stageId: stage.stageId,
    pipelineId: stage.pipelineId,
    authorizedIncarnationId: observation.incarnationId,
    anchorTransactionId: anchor.transactionId,
    ownTransactionPolicy: policy,
  });
  if (!selected.ok) return { state: "unavailable", reason: "stage-definition-unavailable" };
  const { firstOrdinal, lastOrdinal, membership } = selected.source;
  return {
    state: "available",
    stageId: selected.stageId,
    definition: selected.definition,
    version: {
      activationId: selected.activationId,
      incarnationId: selected.incarnationId,
      firstOrdinal,
      lastOrdinal,
      membership,
    },
  };
}

async function readAnchoredDefinition(
  tx: Db,
  requestActor: PermSetUser,
  filters: DashboardFilters,
  request: z.output<typeof requestSchema>,
  signal: AbortSignal,
): Promise<CurrentDealStageDefinition> {
  const actor = await currentActor(tx, requestActor, signal);
  if (actor === null) return { state: "unavailable", reason: "not-visible-or-not-recorded" };
  const history = await readCurrentDealHistory(tx, actor, filters, request.dealId, signal);
  if (history.state === "missing") return history;
  if (history.state === "unavailable") return history;
  if (history.state === "partial" || !history.complete)
    return { state: "unavailable", reason: "history-limit" };
  const anchor = history.events.find((event) => event.eventId === request.anchorEventId);
  if (anchor === undefined) return { state: "unavailable", reason: "anchor-unavailable" };
  const stage = stageReference.safeParse(
    request.side === "before" ? anchor.beforeState : anchor.afterState,
  );
  if (!stage.success) return { state: "unavailable", reason: "anchor-unavailable" };
  const observation = await readStageObservation(
    tx,
    anchor,
    stage.data,
    request.ownTransactionPolicy,
    signal,
  );
  return selectObservation(observation, anchor, stage.data, request.ownTransactionPolicy);
}

// Internal read. Authentication and report-scope resolution remain the caller's responsibility.
// The chosen side identifies a stage, and the own-transaction policy controls definition
// membership. Including the final own transaction can select a rename after the raw anchor.
export async function readCurrentDealStageDefinition(
  db: Db,
  actor: PermSetUser,
  filters: DashboardFilters,
  input: StageDefinitionRequest,
  signal: AbortSignal,
): Promise<CurrentDealStageDefinition> {
  signal.throwIfAborted();
  const request = requestSchema.safeParse(input);
  if (!request.success) return { state: "unavailable", reason: "invalid-definition-request" };
  // A Drizzle transaction uses a savepoint for nested calls and ignores the isolation config.
  // A manually borrowed client may already be in a transaction. Own a fresh pool transaction.
  if (!("$client" in db) || !(db.$client instanceof Pool))
    return { state: "unavailable", reason: "definition-read-failed" };
  try {
    return await db.transaction(
      async (tx) => {
        signal.throwIfAborted();
        await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
        await tx.execute(sql`SET LOCAL lock_timeout = '2000ms'`);
        const result = await readAnchoredDefinition(tx, actor, filters, request.data, signal);
        signal.throwIfAborted();
        return result;
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return { state: "unavailable", reason: "definition-read-failed" };
  }
}
