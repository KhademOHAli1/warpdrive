import type { Pool } from "pg";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { TestDb } from "@/test/db";

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const SUPPLIED_VERSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export async function seedWriteVersionParents(h: TestDb) {
  const owner = await seedUser(h.db);
  const { pipeline, stages } = await seedPipelineWithStages(h.db, ["Version fixture"]);
  const stage = stages[0];
  if (stage === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "revision fixture stage is missing");
  const parents = await h.pool.query<{
    groupId: string;
    orgId: string;
    personId: string;
    lostReasonId: string;
  }>(
    `WITH fixture_group AS (
       INSERT INTO visibility_groups(name) VALUES ('Revision fixture group') RETURNING id
     ), fixture_org AS (
       INSERT INTO organizations(name, owner_id, visibility_level)
       VALUES ('Revision fixture organization', $1, 'owner') RETURNING id
     ), fixture_person AS (
       INSERT INTO persons(name, owner_id, org_id, visibility_level)
       SELECT 'Revision fixture person', $1, id, 'owner' FROM fixture_org RETURNING id
     ), fixture_reason AS (
       INSERT INTO lost_reasons(name) VALUES ('Revision fixture reason') RETURNING id
     )
     SELECT g.id AS "groupId", o.id AS "orgId", p.id AS "personId", r.id AS "lostReasonId"
     FROM fixture_group g, fixture_org o, fixture_person p, fixture_reason r`,
    [owner.id],
  );
  const related = parents.rows[0];
  if (related === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "revision fixture parents are missing");
  await h.pool.query(
    `INSERT INTO user_preferences(user_id, ui)
     VALUES ($1, '{"revisionFixture":{"unrelated":true,"locale":"fa"}}'::jsonb)`,
    [owner.id],
  );
  return { ownerId: owner.id, pipelineId: pipeline.id, stageId: stage.id, ...related };
}

type Parents = Awaited<ReturnType<typeof seedWriteVersionParents>>;

export async function insertLegacyWriteVersionDeal(
  pool: Pool,
  parents: Parents,
  options: {
    title?: string;
    status?: "open" | "won" | "lost";
    archived?: boolean;
    deleted?: boolean;
  } = {},
): Promise<string> {
  // The same old-column INSERT works on both sides of the actual canonical upgrade.
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO public.deals (
       title, status, value, currency, expected_close_date, labels,
       source_channel, source_channel_id, lost_reason, lost_reason_id, won_time, lost_time,
       pipeline_id, stage_id, board_position, person_id, org_id, owner_id,
       visibility_level, visibility_group_id, visible_to_user_ids,
       last_activity_at, next_activity_at, stage_entered_at, custom_fields,
       created_at, updated_at, deleted_at, archived_at
     ) VALUES (
       $1, $2::deal_status, 123.4567, 'EUR', '2027-06-04'::date, ARRAY['Hot', 'Followup'],
       'revision fixture', 'source:retained', 'retained reason', $3,
       CASE WHEN $2 = 'won' THEN '2002-01-02T03:04:05.654321Z'::timestamptz END,
       CASE WHEN $2 = 'lost' THEN '2002-02-03T04:05:06.123456Z'::timestamptz END,
       $4, $5, 12.3456, $6, $7, $8, 'group', $9, ARRAY[$8::uuid],
       '1999-01-02T03:04:05.654321Z', '2030-04-05T06:07:08.123456Z',
       '2001-01-02T03:04:05.987654Z', '{"retained":{"flag":true},"list":[1,2]}'::jsonb,
       '1998-01-02T03:04:05.123456Z', '2001-02-03T04:05:06.123456Z',
       $10::timestamptz, $11::timestamptz
     ) RETURNING id`,
    [
      options.title ?? "Preserved legacy deal",
      options.status ?? "open",
      parents.lostReasonId,
      parents.pipelineId,
      parents.stageId,
      parents.personId,
      parents.orgId,
      parents.ownerId,
      parents.groupId,
      options.deleted === true ? "2005-06-07T08:09:10.123456Z" : null,
      options.archived === true ? "2003-04-05T06:07:08.654321Z" : null,
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "revision fixture insert returned no deal");
  return row.id;
}

export async function previousDealFields(pool: Pool, id: string) {
  const result = await pool.query<{ value: Record<string, unknown> }>(
    "SELECT to_jsonb(d) - 'write_version' AS value FROM public.deals d WHERE id = $1",
    [id],
  );
  const row = result.rows[0];
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "revision fixture deal disappeared");
  return row.value;
}

export async function storedWriteVersion(pool: Pool, id: string): Promise<string | null> {
  // JSON lookup makes the pre-feature baseline an explicit assertion RED, not missing-column setup.
  const result = await pool.query<{ version: string | null }>(
    "SELECT to_jsonb(d)->>'write_version' AS version FROM public.deals d WHERE id = $1",
    [id],
  );
  const row = result.rows[0];
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "revision fixture token row disappeared");
  return row.version;
}

export async function unrelatedRevisionRows(pool: Pool) {
  return (
    await pool.query<{ value: Record<string, unknown> }>(`
    SELECT jsonb_build_object(
      'users', (SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM users u),
      'preferences', (SELECT jsonb_agg(to_jsonb(p) ORDER BY user_id) FROM user_preferences p),
      'groups', (SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM visibility_groups g),
      'pipelines', (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM pipelines p),
      'stages', (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM stages s),
      'organizations', (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM organizations o),
      'persons', (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM persons p),
      'lostReasons', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM lost_reasons r)
    ) AS value
  `)
  ).rows;
}
