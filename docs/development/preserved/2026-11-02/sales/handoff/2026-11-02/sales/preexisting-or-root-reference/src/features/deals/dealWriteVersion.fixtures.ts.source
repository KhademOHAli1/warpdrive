import type { Pool } from "pg";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { TestDb } from "@/test/db";

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const SUPPLIED_VERSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export async function seedWriteVersionParents(db: TestDb["db"]) {
  const owner = await seedUser(db);
  const { pipeline, stages } = await seedPipelineWithStages(db, ["Version fixture"]);
  const stage = stages[0];
  if (stage === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "version fixture stage is missing");
  return { ownerId: owner.id, pipelineId: pipeline.id, stageId: stage.id };
}

export type WriteVersionParents = Awaited<ReturnType<typeof seedWriteVersionParents>>;

export async function insertLegacyWriteVersionDeal(
  pool: Pool,
  parents: WriteVersionParents,
  options: {
    title?: string;
    status?: "open" | "won" | "lost";
    archived?: boolean;
    deleted?: boolean;
  } = {},
): Promise<string> {
  // Raw SQL deliberately works before write_version exists and preserves microseconds.
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO public.deals (
      title, status, value, currency, expected_close_date, labels,
      source_channel, source_channel_id, lost_reason,
      pipeline_id, stage_id, board_position, owner_id, visibility_level, visible_to_user_ids,
      last_activity_at, next_activity_at, stage_entered_at, custom_fields,
      created_at, updated_at, deleted_at, archived_at
    ) VALUES (
      $1, $2::deal_status, 123.4567, 'EUR', '2027-06-04'::date, ARRAY['Hot', 'Followup'],
      'version fixture', 'source:retained', 'retained reason',
      $3, $4, 12.3456, $5, 'all', ARRAY[$5::uuid],
      '1999-01-02T03:04:05.654321Z', '2030-04-05T06:07:08.123456Z',
      '2001-01-02T03:04:05.987654Z', '{"retained":{"flag":true},"list":[1,2]}'::jsonb,
      '1998-01-02T03:04:05.123456Z', '2001-02-03T04:05:06.123456Z',
      $6::timestamptz, $7::timestamptz
    ) RETURNING id`,
    [
      options.title ?? "Preserved legacy deal",
      options.status ?? "open",
      parents.pipelineId,
      parents.stageId,
      parents.ownerId,
      options.deleted === true ? "2005-06-07T08:09:10.123456Z" : null,
      options.archived === true ? "2003-04-05T06:07:08.654321Z" : null,
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "version fixture insert returned no deal");
  return row.id;
}

export async function previousDealFields(pool: Pool, dealId: string) {
  const result = await pool.query<{ value: Record<string, unknown> }>(
    "SELECT to_jsonb(d) - 'write_version' AS value FROM public.deals AS d WHERE id = $1",
    [dealId],
  );
  const row = result.rows[0];
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "version fixture deal disappeared");
  return row.value;
}

export async function storedWriteVersion(pool: Pool, dealId: string): Promise<string> {
  const result = await pool.query<{ version: string }>(
    "SELECT write_version::text AS version FROM public.deals WHERE id = $1",
    [dealId],
  );
  const row = result.rows[0];
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "version fixture token disappeared");
  return row.version;
}

export async function writeVersionFixtureLedger(pool: Pool) {
  return (
    await pool.query<{ id: number; hash: string; createdAt: string }>(
      'SELECT id, hash, created_at::text AS "createdAt" FROM drizzle.__drizzle_migrations ORDER BY id',
    )
  ).rows;
}
