import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import type { TestDb } from "@/test/db";
import { type AnalyticsHistoryEvent, analyticsHistoryEvent } from "./contracts";

export interface HistorySourceIds {
  userId: string;
  pipelineId: string;
  stageId: string;
  otherStageId: string;
}

interface SourceRow {
  kind: string;
  id: string;
  state: string;
}

export interface HistoryCaptureFixture extends HistorySourceIds {
  dealId: string;
  beforeSources: SourceRow[];
  beforeReceipts: { hash: string; createdAt: string }[];
}

type SqlConnection = Pick<Pool, "query">;

export const LEGACY_CREATED_AT = "2019-01-02T03:04:05.123456Z";
export const LEGACY_STAGE_ENTERED_AT = "2020-02-03T04:05:06.654321Z";
export const EXACT_LEGACY_VALUE = "99999999999999.1234";

export async function historySourceRows(sql: SqlConnection): Promise<SourceRow[]> {
  // Keep JSON as text: whole-row preservation must not round numeric money in JS.
  const result = await sql.query<SourceRow>(`
    SELECT 'deal' AS kind, d.id::text AS id, row_to_json(d)::text AS state FROM public.deals d
    UNION ALL
    SELECT 'stage' AS kind, s.id::text AS id, row_to_json(s)::text AS state FROM public.stages s
    UNION ALL
    SELECT 'pipeline' AS kind, p.id::text AS id, row_to_json(p)::text AS state FROM public.pipelines p
    ORDER BY kind, id
  `);
  return result.rows;
}

export async function historyMigrationReceipts(sql: SqlConnection) {
  const result = await sql.query<{ hash: string; createdAt: string }>(
    'SELECT hash, created_at::text AS "createdAt" FROM drizzle.__drizzle_migrations ORDER BY created_at',
  );
  return result.rows;
}

export async function insertHistoryDeal(
  sql: SqlConnection,
  ids: HistorySourceIds,
  input: {
    id?: string;
    title?: string;
    value?: string | null;
    currency?: string;
    createdAt?: string;
  } = {},
) {
  const result = await sql.query<{ id: string; writeVersion: string }>(
    `INSERT INTO public.deals (
       id, title, pipeline_id, stage_id, owner_id, currency, value,
       visibility_level, created_at, stage_entered_at, custom_fields
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'owner',$8::timestamptz,$9::timestamptz,$10::jsonb)
     RETURNING id::text AS id, write_version::text AS "writeVersion"`,
    [
      input.id ?? randomUUID(),
      input.title ?? "Populated legacy opportunity",
      ids.pipelineId,
      ids.stageId,
      ids.userId,
      input.currency ?? "EUR",
      input.value === undefined ? EXACT_LEGACY_VALUE : input.value,
      input.createdAt ?? LEGACY_CREATED_AT,
      LEGACY_STAGE_ENTERED_AT,
      JSON.stringify({ privateInput: "do-not-copy-into-analytics", sourceRevision: "fixture-v1" }),
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("History fixture deal insert returned no row");
  return row;
}

async function applyPrivateCaptureProposal(pool: Pool) {
  const proposal = await readFile(
    new URL("../../../../docs/analytics/history-capture-proposal.sql", import.meta.url),
    "utf8",
  );
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout='5000ms'; SET lock_timeout='2000ms'");
    // The private proposal owns BEGIN/COMMIT. Never add it to the canonical journal here.
    await client.query(proposal);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    try {
      await client.query("RESET statement_timeout; RESET lock_timeout");
    } finally {
      client.release();
    }
  }
}

export async function prepareHistoryCapture(h: TestDb): Promise<HistoryCaptureFixture> {
  const ids: HistorySourceIds = {
    userId: randomUUID(),
    pipelineId: randomUUID(),
    stageId: randomUUID(),
    otherStageId: randomUUID(),
  };
  await h.pool.query("INSERT INTO users (id,email,name) VALUES ($1,$2,'History fixture owner')", [
    ids.userId,
    `history-${ids.userId}@example.test`,
  ]);
  await h.pool.query("INSERT INTO pipelines (id,name,\"order\") VALUES ($1,'Legacy pipeline',7)", [
    ids.pipelineId,
  ]);
  await h.pool.query(
    `INSERT INTO stages (id,pipeline_id,name,"order",rotting_days)
     VALUES ($1,$3,'Legacy qualification',0,14),($2,$3,'Legacy proposal',1,21)`,
    [ids.stageId, ids.otherStageId, ids.pipelineId],
  );
  const deal = await insertHistoryDeal(h.pool, ids);
  const beforeSources = await historySourceRows(h.pool);
  const beforeReceipts = await historyMigrationReceipts(h.pool);
  await applyPrivateCaptureProposal(h.pool);
  return { ...ids, dealId: deal.id, beforeSources, beforeReceipts };
}

export async function readCaptureEvents(
  sql: SqlConnection,
  entityKind?: AnalyticsHistoryEvent["entityKind"],
  entityId?: string,
): Promise<AnalyticsHistoryEvent[]> {
  const result = await sql.query(
    `SELECT event_id::text AS "eventId", ordinal::text AS ordinal,
       activation_id::text AS "activationId", entity_kind AS "entityKind",
       entity_id::text AS "entityId", incarnation_id::text AS "incarnationId",
       event_kind AS "eventKind", schema_version AS "schemaVersion",
       transaction_id AS "transactionId", observation_snapshot::text AS "observationSnapshot",
       to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "observedAt",
       before_state AS "beforeState", after_state AS "afterState",
       before_write_version::text AS "beforeWriteVersion",
       after_write_version::text AS "afterWriteVersion", actor_id::text AS "actorId",
       command_id AS "commandId"
     FROM public.analytics_history_events
     WHERE ($1::text IS NULL OR entity_kind=$1) AND ($2::uuid IS NULL OR entity_id=$2)
     ORDER BY ordinal`,
    [entityKind ?? null, entityId ?? null],
  );
  return result.rows.map((row: unknown) => analyticsHistoryEvent.parse(row));
}

export async function readCaptureHead(sql: SqlConnection, entityKind: string, entityId: string) {
  const result = await sql.query<{
    incarnationId: string;
    active: boolean;
    lastEventOrdinal: string;
    lastWriteVersion: string | null;
  }>(
    `SELECT incarnation_id::text AS "incarnationId", active,
       last_event_ordinal::text AS "lastEventOrdinal", last_write_version::text AS "lastWriteVersion"
     FROM public.analytics_history_heads WHERE entity_kind=$1 AND entity_id=$2`,
    [entityKind, entityId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("History fixture expected a captured head");
  return row;
}

export async function beginHistoryTransaction(client: PoolClient) {
  await client.query(
    "BEGIN; SET LOCAL statement_timeout='2500ms'; SET LOCAL lock_timeout='1500ms'",
  );
}
