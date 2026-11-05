import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { teamMembers } from "@/db/schema";
import { currencyCode } from "@/features/currencies/currencySchema";
import { resolveAccountLocalePreferences } from "@/features/i18n/accountPreferences";
import { getPreferences } from "@/features/identity/preferencesRepo";
import type { PermSetUser } from "@/features/permissions/effective";
import { readBaseCurrency } from "@/features/settings/readBaseCurrency";
import { visibleDealPopulation } from "@/features/stats/dealPopulation";
import { onlyOwners, resolveOwnerIds } from "@/features/stats/ownerIds";
import { ownerScope } from "@/features/stats/ownerScope";
import { ownerScopeInput } from "@/features/stats/schemas";
import { isPipelineVisible } from "@/features/stats/visiblePipelines";
import { hydrateActor } from "@/server/hydrateActor";
import type { OwnerIdFilter, OwnerScope } from "@/types/stats";
import { historyOrdinal, historyVisibilitySnapshot } from "./contracts";
import {
  INVENTORY_SNAPSHOT_DEFINITION,
  INVENTORY_SNAPSHOT_DEFINITION_VERSION,
} from "./inventorySnapshotDefinition";
import { type HistoryInstallation, readHistoryInstallation } from "./repository";

export const MAX_INVENTORY_SNAPSHOT_FACTS = 5_000;

const inputSchema = z.strictObject({
  pipelineId: z
    .guid()
    .transform((id) => id.toLowerCase())
    .nullable()
    .default(null),
  ownerScope: ownerScopeInput.default({ kind: "me" }),
  currency: currencyCode.optional(),
});

const observationSchema = z.strictObject({
  transactionSnapshot: historyVisibilitySnapshot,
  observedAt: z
    .string()
    .datetime()
    .regex(/\.\d{6}Z$/),
});

const factSchema = z.strictObject({
  entityId: z.guid(),
  incarnationId: z.guid(),
  tipOrdinal: historyOrdinal,
  pipelineId: z.guid(),
  stageId: z.guid(),
  ownerId: z.guid(),
  status: z.enum(["open", "won", "lost"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  value: z
    .string()
    .regex(/^-?\d{1,14}(\.\d{1,4})?$/)
    .nullable(),
});

const inventoryReadSchema = z.strictObject({
  ownWritesPending: z.boolean(),
  overLimit: z.boolean(),
  selectedPipelineCaptured: z.boolean(),
  complete: z.boolean(),
  records: z.array(z.unknown()),
});

export type InventorySnapshotRequest = z.input<typeof inputSchema>;
type Observation = z.output<typeof observationSchema>;
type InventoryFact = z.output<typeof factSchema>;
type InventoryRead = z.output<typeof inventoryReadSchema>;

interface SnapshotScope {
  pipelineId: string | null;
  ownerScope: OwnerScope;
  owners: OwnerIdFilter;
}

export type InventorySnapshotWrite =
  | Exclude<HistoryInstallation, { state: "installed" }>
  | {
      state: "unavailable";
      reason:
        | "invalid-snapshot-request"
        | "snapshot-transaction-unavailable"
        | "snapshot-write-failed"
        | "snapshot-scope-unavailable"
        | "snapshot-scope-limit"
        | "snapshot-fact-limit"
        | "snapshot-capture-incomplete"
        | "source-writes-pending";
    }
  | { state: "created"; snapshotId: string; observedAt: string; factCount: number };

type Unavailable = Extract<InventorySnapshotWrite, { state: "unavailable" }>;

// Authentication is supplied by the server caller. Recheck durable actor authority at the
// capture snapshot and retain the request's ceiling for a grant added since request hydration.
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

async function resolveSnapshotOwners(
  tx: Db,
  actor: PermSetUser,
  effective: OwnerScope,
  signal: AbortSignal,
): Promise<OwnerIdFilter | null> {
  if (effective.kind !== "team") return resolveOwnerIds(tx, actor, effective, signal);
  signal.throwIfAborted();
  // Same membership rule as resolveOwnerIds, with a bound on the persisted team membership.
  const members = await tx
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, effective.teamId))
    .orderBy(teamMembers.userId)
    .limit(MAX_INVENTORY_SNAPSHOT_FACTS + 1);
  signal.throwIfAborted();
  if (members.length > MAX_INVENTORY_SNAPSHOT_FACTS) return null;
  return onlyOwners(members.map(({ userId }) => userId));
}

async function readObservation(tx: Db, signal: AbortSignal): Promise<Observation | null> {
  signal.throwIfAborted();
  // The first data read fixes the repeatable-read snapshot before the wall clock is sampled.
  const result = await tx.execute(sql`
    SELECT pg_catalog.pg_current_snapshot()::text AS "transactionSnapshot",
      pg_catalog.to_char(pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "observedAt"
  `);
  signal.throwIfAborted();
  const parsed = observationSchema.safeParse((result as unknown as { rows: unknown[] }).rows[0]);
  return parsed.success ? parsed.data : null;
}

async function readInventoryFacts(
  tx: Db,
  actor: PermSetUser,
  scope: SnapshotScope,
  currency: string,
  activationId: string,
  observation: Observation,
  signal: AbortSignal,
): Promise<InventoryRead | null> {
  // The shared live visibility predicate ignores dates. The observed day only fills the shared
  // filter type and does not define a historical period or get written into snapshot scope.
  const day = observation.observedAt.slice(0, 10);
  const visible = await visibleDealPopulation(
    tx,
    actor,
    { currency, pipelineId: scope.pipelineId, owners: scope.owners, from: day, to: day },
    signal,
  );
  const result = await tx.execute(sql`
    WITH candidates AS MATERIALIZED (
      SELECT d.id, d.pipeline_id, d.stage_id, d.owner_id, d.status, d.currency,
        d.value::text AS value
      FROM public.deals d JOIN public.pipelines p ON p.id = d.pipeline_id
      WHERE ${visible}
      ORDER BY d.id LIMIT ${MAX_INVENTORY_SNAPSHOT_FACTS + 1}
    ), population_bound AS MATERIALIZED (
      SELECT count(*) > ${MAX_INVENTORY_SNAPSHOT_FACTS} AS too_large FROM candidates
    ), admitted AS MATERIALIZED (
      SELECT * FROM candidates WHERE NOT (SELECT too_large FROM population_bound)
    ), projected_entities AS MATERIALIZED (
      SELECT 'deal' AS kind, d.id, public.analytics_project_deal(d) AS state
      FROM admitted c JOIN public.deals d ON d.id = c.id
      UNION ALL
      SELECT 'stage', s.id, public.analytics_project_stage(s)
      FROM public.stages s JOIN (
        SELECT DISTINCT stage_id, pipeline_id FROM admitted
      ) refs ON refs.stage_id = s.id AND refs.pipeline_id = s.pipeline_id
      UNION ALL
      SELECT 'pipeline', p.id, public.analytics_project_pipeline(p)
      FROM public.pipelines p JOIN (
        SELECT pipeline_id AS id FROM admitted
        UNION SELECT ${scope.pipelineId}::uuid
      ) refs ON refs.id = p.id
    ), qualified_tips AS MATERIALIZED (
      SELECT source.kind, source.id, h.incarnation_id, h.last_event_ordinal
      FROM projected_entities source
      JOIN public.analytics_history_heads h ON h.entity_kind = source.kind AND h.entity_id = source.id
        AND h.activation_id = ${activationId}::uuid AND h.active = true
      JOIN public.analytics_history_events tip ON tip.ordinal = h.last_event_ordinal
        AND tip.entity_kind = h.entity_kind AND tip.entity_id = h.entity_id
        AND tip.activation_id = h.activation_id AND tip.incarnation_id = h.incarnation_id
      WHERE tip.after_state = source.state
        AND pg_catalog.pg_visible_in_snapshot(tip.transaction_id::pg_catalog.xid8,
          ${observation.transactionSnapshot}::pg_catalog.pg_snapshot)
        AND NOT EXISTS (
          SELECT 1 FROM public.analytics_history_events later
          WHERE later.entity_kind = h.entity_kind AND later.entity_id = h.entity_id
            AND later.activation_id = h.activation_id AND later.ordinal > h.last_event_ordinal
        )
    )
    SELECT EXISTS (
      SELECT 1 FROM public.analytics_history_events pending
      WHERE pending.transaction_id = pg_catalog.pg_current_xact_id_if_assigned()::text
    ) AS "ownWritesPending",
      (SELECT too_large FROM population_bound) AS "overLimit",
      (${scope.pipelineId}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM qualified_tips q WHERE q.kind = 'pipeline' AND q.id = ${scope.pipelineId}::uuid
      )) AS "selectedPipelineCaptured",
      coalesce(bool_and(deal.id IS NOT NULL AND stage.id IS NOT NULL AND pipeline.id IS NOT NULL),
        true) AS complete,
      coalesce(jsonb_agg(jsonb_build_object(
        'entityId', c.id, 'incarnationId', deal.incarnation_id,
        'tipOrdinal', deal.last_event_ordinal::text, 'pipelineId', c.pipeline_id,
        'stageId', c.stage_id, 'ownerId', c.owner_id, 'status', c.status,
        'currency', c.currency, 'value', c.value
      ) ORDER BY c.id), '[]'::jsonb) AS records
    FROM admitted c
    LEFT JOIN qualified_tips deal ON deal.kind = 'deal' AND deal.id = c.id
    LEFT JOIN qualified_tips stage ON stage.kind = 'stage' AND stage.id = c.stage_id
    LEFT JOIN qualified_tips pipeline ON pipeline.kind = 'pipeline' AND pipeline.id = c.pipeline_id
  `);
  signal.throwIfAborted();
  const parsed = inventoryReadSchema.safeParse((result as unknown as { rows: unknown[] }).rows[0]);
  return parsed.success ? parsed.data : null;
}

function validateFacts(
  read: InventoryRead | null,
  currency: string,
): Unavailable | { state: "ready"; records: InventoryFact[] } {
  if (read === null) return { state: "unavailable", reason: "snapshot-write-failed" };
  if (read.ownWritesPending) return { state: "unavailable", reason: "source-writes-pending" };
  if (read.overLimit || read.records.length > MAX_INVENTORY_SNAPSHOT_FACTS)
    return { state: "unavailable", reason: "snapshot-fact-limit" };
  if (!read.complete || !read.selectedPipelineCaptured)
    return { state: "unavailable", reason: "snapshot-capture-incomplete" };
  const records: InventoryFact[] = [];
  for (const row of read.records) {
    const parsed = factSchema.safeParse(row);
    if (!parsed.success || parsed.data.currency !== currency)
      return { state: "unavailable", reason: "snapshot-capture-incomplete" };
    records.push(parsed.data);
  }
  return { state: "ready", records };
}

interface SnapshotInsert {
  creatorId: string;
  activationId: string;
  scope: SnapshotScope;
  currency: string;
  timeZone: string;
  calendar: "gregory" | "persian";
  observation: Observation;
  records: InventoryFact[];
}

async function insertSnapshot(tx: Db, data: SnapshotInsert, signal: AbortSignal) {
  signal.throwIfAborted();
  const result = await tx.execute(sql`
    INSERT INTO public.analytics_report_snapshots (
      activation_id, kind, definition_version, report_definition, scope, currency,
      time_zone, calendar, cutoff_observed_at, transaction_snapshot, records, created_by
    ) VALUES (
      ${data.activationId}::uuid, 'pipeline-inventory', ${INVENTORY_SNAPSHOT_DEFINITION_VERSION},
      ${JSON.stringify(INVENTORY_SNAPSHOT_DEFINITION)}::jsonb, ${JSON.stringify(data.scope)}::jsonb,
      ${data.currency}, ${data.timeZone}, ${data.calendar}, ${data.observation.observedAt}::timestamptz,
      ${data.observation.transactionSnapshot}::pg_catalog.pg_snapshot,
      ${JSON.stringify(data.records)}::jsonb,
      ${data.creatorId}::uuid
    ) RETURNING id::text
  `);
  signal.throwIfAborted();
  const id = z.guid().safeParse((result as unknown as { rows: { id?: unknown }[] }).rows[0]?.id);
  if (!id.success) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Snapshot insert returned no ID");
  return id.data;
}

async function writeInSnapshot(
  tx: Db,
  requestActor: PermSetUser,
  input: z.output<typeof inputSchema>,
  signal: AbortSignal,
): Promise<InventorySnapshotWrite> {
  const observation = await readObservation(tx, signal);
  if (observation === null) return { state: "unavailable", reason: "snapshot-write-failed" };
  const actor = await currentActor(tx, requestActor, signal);
  if (actor === null) return { state: "unavailable", reason: "snapshot-scope-unavailable" };
  const installation = await readHistoryInstallation(tx, signal);
  if (installation.state !== "installed") return installation;
  if (input.pipelineId !== null && !(await isPipelineVisible(tx, actor, input.pipelineId, signal)))
    return { state: "unavailable", reason: "snapshot-scope-unavailable" };
  const effective = ownerScope(actor, input.ownerScope);
  const owners = await resolveSnapshotOwners(tx, actor, effective, signal);
  if (owners === null) return { state: "unavailable", reason: "snapshot-scope-limit" };
  const scope: SnapshotScope = { pipelineId: input.pipelineId, ownerScope: effective, owners };
  const currency = input.currency ?? (await readBaseCurrency(tx, signal));
  const supported = currencyCode.safeParse(currency);
  if (!supported.success || supported.data !== currency)
    return { state: "unavailable", reason: "snapshot-scope-unavailable" };
  const preferences = await getPreferences(tx, actor.id, signal);
  const { timeZone, calendar } = resolveAccountLocalePreferences({
    saved: preferences.ui.localePreferences,
    profileTimeZone: preferences.timezone,
  });
  const activationId = installation.activation.activationId;
  const read = await readInventoryFacts(
    tx,
    actor,
    scope,
    currency,
    activationId,
    observation,
    signal,
  );
  const validated = validateFacts(read, currency);
  if (validated.state !== "ready") return validated;
  const snapshotId = await insertSnapshot(
    tx,
    {
      creatorId: actor.id,
      activationId,
      scope,
      currency,
      timeZone,
      calendar,
      observation,
      records: validated.records,
    },
    signal,
  );
  return {
    state: "created",
    snapshotId,
    observedAt: observation.observedAt,
    factCount: validated.records.length,
  };
}

// Internal private writer. Each successful call records one new live observation. Stored
// membership and creator authority grant no future read or share permission, and a missing key
// does not establish physical absence. The creator, cutoff and regional values are server-owned.
export async function writeCurrentInventorySnapshot(
  db: Db,
  actor: PermSetUser,
  input: InventorySnapshotRequest,
  signal: AbortSignal,
): Promise<InventorySnapshotWrite> {
  signal.throwIfAborted();
  const request = inputSchema.safeParse(input);
  if (!request.success) return { state: "unavailable", reason: "invalid-snapshot-request" };
  // A nested transaction is a savepoint, and a borrowed client can already have pending writes.
  if (!("$client" in db) || !(db.$client instanceof Pool))
    return { state: "unavailable", reason: "snapshot-transaction-unavailable" };
  try {
    return await db.transaction(
      async (tx) => {
        signal.throwIfAborted();
        await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
        await tx.execute(sql`SET LOCAL lock_timeout = '2000ms'`);
        return writeInSnapshot(tx, actor, request.data, signal);
      },
      { isolationLevel: "repeatable read", accessMode: "read write" },
    );
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return { state: "unavailable", reason: "snapshot-write-failed" };
  }
}
