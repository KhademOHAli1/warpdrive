import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { visibleDealPopulation } from "@/features/stats/dealPopulation";
import { onlyOwners } from "@/features/stats/ownerIds";
import { visiblePipelinePredicate } from "@/features/stats/visiblePipelines";
import type { DashboardFilters } from "@/types/stats";
import {
  type AnalyticsHistoryEvent,
  analyticsHistoryEvent,
  type HistoryActivation,
  historyActivation,
  historyVisibilitySnapshot,
} from "./contracts";
import { sameHistoryState } from "./fold";

export type HistoryInstallation =
  | { state: "missing"; reason: "capture-not-installed" }
  | { state: "unavailable"; reason: "capture-metadata-invalid" | "capture-safety-unavailable" }
  | { state: "installed"; activation: HistoryActivation };

export const MAX_DEAL_HISTORY_EVENTS = 5_000;

// Global installation metadata only: baseline row counts never enter a viewer DTO.
export async function readHistoryInstallation(
  db: Db,
  signal: AbortSignal,
): Promise<HistoryInstallation> {
  signal.throwIfAborted();
  const presence = await db.execute(sql`
    SELECT to_regclass('public.analytics_history_coverage') IS NOT NULL
       AND to_regclass('public.analytics_history_events') IS NOT NULL
       AND to_regclass('public.analytics_history_heads') IS NOT NULL AS installed
  `);
  signal.throwIfAborted();
  const ready = (presence as unknown as { rows: { installed: boolean }[] }).rows[0];
  if (ready === undefined)
    throw new AppError(ERROR_IDS.DB_READ_FAILED, "History presence read returned no row");
  if (!ready.installed) return { state: "missing", reason: "capture-not-installed" };
  const result = await db.execute(sql`
    WITH required_guard(relation_name, trigger_name, function_name, trigger_type) AS (VALUES
      ('deals','analytics_deals_capture','analytics_capture_row_change',29),
      ('stages','analytics_stages_capture','analytics_capture_row_change',29),
      ('pipelines','analytics_pipelines_capture','analytics_capture_row_change',29),
      ('deals','analytics_deals_truncate_guard','analytics_reject_source_truncate',34),
      ('stages','analytics_stages_truncate_guard','analytics_reject_source_truncate',34),
      ('pipelines','analytics_pipelines_truncate_guard','analytics_reject_source_truncate',34),
      ('analytics_history_events','analytics_events_insert_guard','analytics_guard_event_insert',7),
      ('analytics_history_events','analytics_events_mutation_guard','analytics_reject_immutable_mutation',27),
      ('analytics_history_events','analytics_events_truncate_guard','analytics_reject_immutable_mutation',34),
      ('analytics_history_heads','analytics_heads_mutation_guard','analytics_guard_head_mutation',31),
      ('analytics_history_heads','analytics_heads_truncate_guard','analytics_guard_head_mutation',34),
      ('analytics_history_coverage','analytics_coverage_mutation_guard','analytics_reject_immutable_mutation',27),
      ('analytics_history_coverage','analytics_coverage_truncate_guard','analytics_reject_immutable_mutation',34),
      ('analytics_report_snapshots','analytics_snapshots_mutation_guard','analytics_reject_immutable_mutation',27),
      ('analytics_report_snapshots','analytics_snapshots_truncate_guard','analytics_reject_immutable_mutation',34)
    ), guard_health AS (
      SELECT count(*) = 15 AS ready FROM required_guard required
      JOIN pg_catalog.pg_trigger installed_trigger ON installed_trigger.tgrelid = to_regclass('public.' || required.relation_name)
        AND installed_trigger.tgname = required.trigger_name AND installed_trigger.tgenabled = 'A'
        AND installed_trigger.tgfoid = to_regprocedure('public.' || required.function_name || '()')
        AND installed_trigger.tgtype = required.trigger_type AND installed_trigger.tgqual IS NULL
        AND installed_trigger.tgnargs = 0 AND installed_trigger.tgattr = ''::int2vector
        AND NOT installed_trigger.tgisinternal AND NOT installed_trigger.tgdeferrable
    )
    SELECT activation_id AS "activationId", schema_version AS "schemaVersion",
      to_char(activated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "activatedAt",
      capture_semantics AS "captureSemantics", health.ready AS "captureReady"
    FROM public.analytics_history_coverage CROSS JOIN guard_health health WHERE id = true
  `);
  signal.throwIfAborted();
  const row = (result as unknown as { rows: Record<string, unknown>[] }).rows[0];
  if (row === undefined) return { state: "unavailable", reason: "capture-metadata-invalid" };
  if (row.captureReady !== true)
    return { state: "unavailable", reason: "capture-safety-unavailable" };
  const parsed = historyActivation.safeParse({
    activationId: row.activationId,
    schemaVersion: row.schemaVersion,
    activatedAt: row.activatedAt,
    captureSemantics: row.captureSemantics,
  });
  return parsed.success
    ? { state: "installed", activation: parsed.data }
    : { state: "unavailable", reason: "capture-metadata-invalid" };
}

interface ObservationRow {
  databaseSnapshot: string;
  observedAt: string;
  ownWritesPending: boolean;
  allowedPipelineIds: string[];
  current: {
    id: string;
    incarnationId: string;
    activationId: string;
    lastEventOrdinal: string;
    projectionMatches: boolean;
  } | null;
  events: unknown[];
}

export type CurrentDealHistory =
  | Exclude<HistoryInstallation, { state: "installed" }>
  | {
      state: "unavailable";
      reason:
        | "not-visible-or-not-recorded"
        | "source-writes-pending"
        | "history-invalid"
        | "history-permission-limited";
    }
  | {
      state: "available" | "partial";
      activation: HistoryActivation;
      observation: { databaseSnapshot: string; observedAt: string };
      current: { id: string; incarnationId: string; activationId: string };
      events: AnalyticsHistoryEvent[];
      limit: number;
      complete: boolean;
    };

function parseObservedEvents(rows: readonly unknown[]): AnalyticsHistoryEvent[] | null {
  const result: AnalyticsHistoryEvent[] = [];
  for (const row of rows) {
    const parsed = analyticsHistoryEvent.safeParse(row);
    if (!parsed.success) return null;
    result.push(parsed.data);
  }
  return result;
}

function hasCompleteStateChain(events: readonly AnalyticsHistoryEvent[]): boolean {
  const first = events[0];
  if (first === undefined || (first.eventKind !== "baseline" && first.eventKind !== "insert"))
    return false;
  let previous = first.afterState;
  for (const event of events.slice(1)) {
    if (event.eventKind === "baseline" || !sameHistoryState(previous, event.beforeState))
      return false;
    previous = event.afterState;
  }
  return true;
}

function hasVisibleHistoricPipelines(
  events: readonly AnalyticsHistoryEvent[],
  allowed: readonly string[],
): boolean {
  const ids = new Set(allowed);
  return events.every((event) =>
    [event.beforeState, event.afterState].every(
      (state) =>
        state === null || (typeof state.pipelineId === "string" && ids.has(state.pipelineId)),
    ),
  );
}

// Internal server reader. It returns only the currently authorized, live incarnation.
// A separate retained-record authority is required before deleted/archived history can
// be reported; copying an old owner into a ledger is not such an authority.
// from/to do not truncate the event chain: report services apply their explicit date basis.
export async function readCurrentDealHistory(
  db: Db,
  actor: PermSetUser,
  filters: DashboardFilters,
  dealId: string,
  signal: AbortSignal,
): Promise<CurrentDealHistory> {
  const installation = await readHistoryInstallation(db, signal);
  if (installation.state !== "installed") return installation;
  const reportFilters = can(actor, "stats.viewOthers")
    ? filters
    : { ...filters, owners: onlyOwners([actor.id]) };
  const visible = await visibleDealPopulation(db, actor, reportFilters, signal);
  const pipelineAuthority = visiblePipelinePredicate(actor) ?? sql`false`;
  const result = await db.execute(sql`
    WITH observation AS MATERIALIZED (
      SELECT pg_catalog.pg_current_snapshot()::text AS snapshot,
        pg_catalog.pg_current_xact_id_if_assigned()::text AS own_transaction,
        to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at
    ), permitted_pipelines AS MATERIALIZED (
      SELECT pipelines.id FROM pipelines
      JOIN public.analytics_history_heads pipeline_head ON pipeline_head.entity_kind = 'pipeline'
        AND pipeline_head.entity_id = pipelines.id AND pipeline_head.active = true
        AND pipeline_head.activation_id = ${installation.activation.activationId}::uuid
      JOIN public.analytics_history_events pipeline_tip ON pipeline_tip.ordinal = pipeline_head.last_event_ordinal
        AND pipeline_tip.entity_kind = 'pipeline' AND pipeline_tip.entity_id = pipelines.id
        AND pipeline_tip.incarnation_id = pipeline_head.incarnation_id
        AND pipeline_tip.activation_id = pipeline_head.activation_id
      WHERE pipelines.is_archived = false AND ${pipelineAuthority}
        AND pipeline_tip.after_state = public.analytics_project_pipeline(pipelines)
        AND NOT EXISTS (SELECT 1 FROM public.analytics_history_events prior_pipeline
          WHERE prior_pipeline.entity_kind = 'pipeline' AND prior_pipeline.entity_id = pipelines.id
            AND prior_pipeline.activation_id = pipeline_head.activation_id
            AND prior_pipeline.incarnation_id <> pipeline_head.incarnation_id)
    ), current_record AS MATERIALIZED (
      SELECT d.id, h.incarnation_id, h.activation_id, h.last_event_ordinal,
        tip.after_state IS NOT DISTINCT FROM public.analytics_project_deal(d) AS projection_matches
      FROM deals d JOIN pipelines p ON p.id = d.pipeline_id
      JOIN public.analytics_history_heads h ON h.entity_kind = 'deal'
        AND h.entity_id = d.id AND h.active = true
      LEFT JOIN public.analytics_history_events tip ON tip.ordinal = h.last_event_ordinal
        AND tip.entity_kind = h.entity_kind AND tip.entity_id = h.entity_id
        AND tip.incarnation_id = h.incarnation_id AND tip.activation_id = h.activation_id
      WHERE d.id = ${dealId}::uuid AND ${visible}
        AND h.activation_id = ${installation.activation.activationId}::uuid
    ), selected_events AS MATERIALIZED (
      SELECT e.* FROM public.analytics_history_events e
      JOIN current_record r ON e.entity_kind = 'deal' AND e.entity_id = r.id
        AND e.incarnation_id = r.incarnation_id AND e.activation_id = r.activation_id
      CROSS JOIN observation o
      WHERE pg_catalog.pg_visible_in_snapshot(
        e.transaction_id::pg_catalog.xid8, o.snapshot::pg_catalog.pg_snapshot
      )
      ORDER BY e.ordinal ASC LIMIT ${MAX_DEAL_HISTORY_EVENTS + 1}
    )
    SELECT o.snapshot AS "databaseSnapshot", o.observed_at AS "observedAt",
      EXISTS(SELECT 1 FROM public.analytics_history_events pending
        WHERE pending.transaction_id = o.own_transaction) AS "ownWritesPending",
      ARRAY(SELECT id::text FROM permitted_pipelines) AS "allowedPipelineIds",
      (SELECT json_build_object('id', r.id, 'incarnationId', r.incarnation_id,
        'activationId', r.activation_id, 'lastEventOrdinal', r.last_event_ordinal::text,
        'projectionMatches', r.projection_matches) FROM current_record r) AS current,
      (SELECT coalesce(json_agg(json_build_object(
        'eventId', e.event_id, 'ordinal', e.ordinal::text, 'activationId', e.activation_id,
        'entityKind', e.entity_kind, 'entityId', e.entity_id, 'incarnationId', e.incarnation_id,
        'eventKind', e.event_kind, 'schemaVersion', e.schema_version,
        'transactionId', e.transaction_id,
        'observationSnapshot', e.observation_snapshot::text,
        'observedAt', to_char(e.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'beforeState', e.before_state, 'afterState', e.after_state,
        'beforeWriteVersion', e.before_write_version, 'afterWriteVersion', e.after_write_version,
        'actorId', e.actor_id, 'commandId', e.command_id
      ) ORDER BY e.ordinal), '[]'::json) FROM selected_events e) AS events
    FROM observation o
  `);
  signal.throwIfAborted();
  const row = (result as unknown as { rows: ObservationRow[] }).rows[0];
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_READ_FAILED, "History observation returned no row");
  if (row.ownWritesPending) return { state: "unavailable", reason: "source-writes-pending" };
  if (row.current === null) return { state: "unavailable", reason: "not-visible-or-not-recorded" };
  const events = parseObservedEvents(row.events.slice(0, MAX_DEAL_HISTORY_EVENTS));
  if (
    events === null ||
    !historyVisibilitySnapshot.safeParse(row.databaseSnapshot).success ||
    !row.current.projectionMatches ||
    !hasCompleteStateChain(events)
  )
    return { state: "unavailable", reason: "history-invalid" };
  if (!hasVisibleHistoricPipelines(events, row.allowedPipelineIds))
    return { state: "unavailable", reason: "history-permission-limited" };
  const complete = row.events.length <= MAX_DEAL_HISTORY_EVENTS;
  if (complete && events.at(-1)?.ordinal !== row.current.lastEventOrdinal)
    return { state: "unavailable", reason: "history-invalid" };
  return {
    state: complete ? "available" : "partial",
    activation: installation.activation,
    observation: { databaseSnapshot: row.databaseSnapshot, observedAt: row.observedAt },
    current: {
      id: row.current.id,
      incarnationId: row.current.incarnationId,
      activationId: row.current.activationId,
    },
    events,
    limit: MAX_DEAL_HISTORY_EVENTS,
    complete,
  };
}
