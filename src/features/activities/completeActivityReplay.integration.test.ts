import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { activities, activityTypes, deals, pipelines } from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import { completeActivity } from "./repo";

let h: TestDb;
afterEach(async () => {
  await h?.close();
});

function actor(id: string): PermSetUser {
  return { id, type: "regular", isActive: true, groupIds: new Set(), flags: new Set() };
}

async function fixture(done = false) {
  h = await makeTestDb();
  const owner = await seedUser(h.db);
  const assignee = await seedUser(h.db);
  const pipe = await seedPipelineWithStages(h.db, ["Synthetic entry"]);
  const stage = pipe.stages[0];
  const [type] = await h.db.select().from(activityTypes).where(eq(activityTypes.key, "call"));
  if (stage === undefined || type === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Completion replay fixture missing");
  const [deal] = await h.db
    .insert(deals)
    .values({
      title: "Synthetic replay deal",
      pipelineId: pipe.pipeline.id,
      stageId: stage.id,
      ownerId: owner.id,
      visibilityLevel: "all",
    })
    .returning();
  if (deal === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Completion replay deal missing");
  const [activity] = await h.db
    .insert(activities)
    .values({
      typeId: type.id,
      subject: "Synthetic replay activity",
      ownerId: owner.id,
      assigneeId: assignee.id,
      dealId: deal.id,
      done,
      doneAt: done ? new Date("2026-10-01T08:15:30.123Z") : null,
    })
    .returning();
  if (activity === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Completion replay activity missing");
  return { activity, deal, pipe, assignee: actor(assignee.id) };
}

async function rejectRedundantWrites() {
  await h.pool.query(`
    CREATE FUNCTION reject_redundant_completion() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.done IS NOT DISTINCT FROM NEW.done THEN
        RAISE EXCEPTION 'redundant completion UPDATE';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER reject_redundant_completion BEFORE UPDATE ON activities
      FOR EACH ROW EXECUTE FUNCTION reject_redundant_completion();
    CREATE FUNCTION reject_replay_recompute() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'completion replay recomputed deal'; END $$;
    CREATE TRIGGER reject_replay_recompute BEFORE UPDATE ON deals
      FOR EACH ROW EXECUTE FUNCTION reject_replay_recompute();
  `);
}

test("same-state retries preserve the exact row and completion timestamp without any write", async () => {
  const f = await fixture();
  // Archived deals remain visible; only archived pipelines hide their activities.
  await h.db
    .update(deals)
    .set({ archivedAt: new Date("2026-10-02T00:00:00.000Z") })
    .where(eq(deals.id, f.deal.id));
  await rejectRedundantWrites();

  for (const done of [false, true]) {
    if (done) {
      await h.db
        .update(activities)
        .set({ done: true, doneAt: new Date("2026-10-01T08:15:30.123Z") })
        .where(eq(activities.id, f.activity.id));
    }
    const [before] = await h.db.select().from(activities).where(eq(activities.id, f.activity.id));
    const result = await completeActivity(
      h.db,
      f.assignee,
      f.activity.id,
      done,
      AbortSignal.timeout(10_000),
    );
    expect(result).toEqual({ ok: true, value: before });
    const [after] = await h.db.select().from(activities).where(eq(activities.id, f.activity.id));
    expect(after).toEqual(before);
  }
});

async function waitForTwoActivityWaiters(): Promise<boolean> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await h.pool.query<{ waiting: number }>(`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock' AND query LIKE '%activities%'
    `);
    if ((result.rows[0]?.waiting ?? 0) >= 2) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

test("concurrent true completions serialize into one write and return the same canonical row", async () => {
  const f = await fixture();
  await h.pool.query(`
    CREATE TABLE completion_writes (kind text NOT NULL);
    CREATE FUNCTION count_completion_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO completion_writes VALUES (TG_TABLE_NAME); RETURN NEW; END $$;
    CREATE TRIGGER count_activity_completion AFTER UPDATE ON activities
      FOR EACH ROW EXECUTE FUNCTION count_completion_write();
    CREATE TRIGGER count_deal_completion AFTER UPDATE ON deals
      FOR EACH ROW EXECUTE FUNCTION count_completion_write();
  `);
  const blocker = await h.pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT id FROM activities WHERE id = $1 FOR UPDATE", [f.activity.id]);
  const running = Promise.allSettled([
    completeActivity(h.db, f.assignee, f.activity.id, true, AbortSignal.timeout(10_000)),
    completeActivity(h.db, f.assignee, f.activity.id, true, AbortSignal.timeout(10_000)),
  ]);
  try {
    // Both requests reach a database lock before release, so overlap is observed, not timed.
    expect(await waitForTwoActivityWaiters()).toBe(true);
    await blocker.query("COMMIT");
    const outcomes = await running;
    const [canonical] = await h.db
      .select()
      .from(activities)
      .where(eq(activities.id, f.activity.id));
    expect(canonical?.done).toBe(true);
    expect(canonical?.doneAt).toBeInstanceOf(Date);
    expect(outcomes).toEqual([
      { status: "fulfilled", value: { ok: true, value: canonical } },
      { status: "fulfilled", value: { ok: true, value: canonical } },
    ]);
    expect(
      (
        await h.pool.query(
          "SELECT kind, count(*)::int AS n FROM completion_writes GROUP BY kind ORDER BY kind",
        )
      ).rows,
    ).toEqual([
      { kind: "activities", n: 1 },
      { kind: "deals", n: 1 },
    ]);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await running;
  }
});

test("same-state requests still deny missing capability and hidden parents before any no-op", async () => {
  const f = await fixture(true);
  const outsider = actor((await seedUser(h.db)).id);
  const complete = (who: PermSetUser) =>
    completeActivity(h.db, who, f.activity.id, true, AbortSignal.timeout(10_000));
  const forbidden = await complete(outsider);
  expect(forbidden.ok).toBe(false);
  if (!forbidden.ok) expect(forbidden.error.id).toBe(ERROR_IDS.ACTIVITY_FORBIDDEN);

  await h.db.update(deals).set({ visibilityLevel: "owner" }).where(eq(deals.id, f.deal.id));
  const hidden = await complete(outsider);
  expect(hidden.ok).toBe(false);
  if (!hidden.ok) expect(hidden.error.id).toBe(ERROR_IDS.ACTIVITY_NOT_FOUND);

  await h.db
    .update(pipelines)
    .set({ isArchived: true })
    .where(eq(pipelines.id, f.pipe.pipeline.id));
  const admin: PermSetUser = { ...f.assignee, type: "admin" };
  const archived = await complete(admin);
  expect(archived.ok).toBe(false);
  if (!archived.ok) expect(archived.error.id).toBe(ERROR_IDS.ACTIVITY_NOT_FOUND);

  await h.db
    .update(pipelines)
    .set({ isArchived: false })
    .where(eq(pipelines.id, f.pipe.pipeline.id));
  await h.db.update(deals).set({ deletedAt: new Date() }).where(eq(deals.id, f.deal.id));
  const deleted = await complete(admin);
  expect(deleted.ok).toBe(false);
  if (!deleted.ok) expect(deleted.error.id).toBe(ERROR_IDS.ACTIVITY_NOT_FOUND);
  const [after] = await h.db.select().from(activities).where(eq(activities.id, f.activity.id));
  expect(after).toEqual(f.activity);
});
