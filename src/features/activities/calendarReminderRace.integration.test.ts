import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { afterEach, beforeEach, expect, it } from "vitest";
import { activities, activityTypes, notifications } from "@/db/schema";
import { activityReminderIntents } from "@/db/schema/activityReminderIntents";
import { seedUser } from "@/db/testing/factories";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { processActivityReminder } from "./reminderDelivery";
import { retryActivityReminder } from "./reminderRetry";

let h: TestDb;
let observer: PoolClient;
const signal = () => AbortSignal.timeout(10_000);
beforeEach(async () => {
  h = await makeTestDb();
  observer = await h.pool.connect();
});
afterEach(async () => {
  await observer.query("ROLLBACK");
  observer.release();
  await h.close();
});

async function fixture() {
  const user = await seedUser(h.db, { isAdmin: true });
  const actor = await hydrateActor(h.db, user.id, signal());
  if (actor === null) throw new Error("Race actor fixture missing");
  const [type] = await h.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new Error("Meeting fixture missing");
  const clock = await h.db.execute<{ now: Date | string }>(sql`SELECT clock_timestamp() AS now`);
  const at = new Date(clock.rows[0]?.now ?? Number.NaN).getTime();
  if (!Number.isFinite(at)) throw new Error("Race DB clock missing");
  const [activity] = await h.db
    .insert(activities)
    .values({
      typeId: type.id,
      subject: "Calendar race",
      ownerId: user.id,
      assigneeId: user.id,
      dueAt: new Date(at + 300_000),
      endAt: new Date(at + 3_900_000),
      durationMinutes: 60,
    })
    .returning();
  if (activity === undefined) throw new Error("Race event missing");
  const [intent] = await h.db
    .insert(activityReminderIntents)
    .values({
      activityId: activity.id,
      managed: true,
      status: "pending",
      eventTimeZone: "UTC",
      reminderTimeZone: "UTC",
      selection: { kind: "before_start", channel: "in_app", leadMinutes: 10 },
      fireAt: new Date(at - 300_000),
    })
    .returning();
  if (intent === undefined) throw new Error("Race intent missing");
  return { user, actor, activity, intent };
}
async function blockedBy(blocker: number): Promise<number> {
  const end = Date.now() + 1_500;
  while (Date.now() < end) {
    // Live lock-manager view, not the transaction-stable activity stats snapshot.
    const rows = await observer.query<{ pid: number }>(
      `SELECT DISTINCT l.pid FROM pg_locks l WHERE NOT l.granted AND l.pid<>pg_backend_pid() AND $1=ANY(pg_blocking_pids(l.pid))`,
      [blocker],
    );
    if (rows.rows[0] !== undefined) return rows.rows[0].pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("No actual Calendar lock waiter observed");
}
async function observerPid() {
  const rows = await observer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  if (rows.rows[0] === undefined) throw new Error("Observer backend missing");
  return rows.rows[0].pid;
}
async function currentIntent(id: string) {
  const [intent] = await h.db
    .select()
    .from(activityReminderIntents)
    .where(eq(activityReminderIntents.activityId, id));
  if (intent === undefined) throw new Error("Current intent missing");
  return intent;
}

it("an absent preference inserted while dispatch waits suppresses the in-app effect", async () => {
  const f = await fixture();
  await observer.query("BEGIN");
  await observer.query(
    `INSERT INTO notification_preferences(user_id,type,in_app,email) VALUES($1,'activity_reminder',false,true)`,
    [f.user.id],
  );
  const work = processActivityReminder(h.db, f.activity.id, f.intent.generationId, signal());
  const settled = work.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  try {
    await blockedBy(await observerPid());
    await observer.query("COMMIT");
    expect(await settled).toMatchObject({ value: { state: "suppressed" } });
    expect((await currentIntent(f.activity.id)).outcomeReason).toBe("not_available");
    expect(await h.db.select().from(notifications)).toHaveLength(0);
  } finally {
    await observer.query("ROLLBACK");
    await settled;
  }
});
it("completion committed while dispatch waits on the activity prevents a stale notification", async () => {
  const f = await fixture();
  await observer.query("BEGIN");
  await observer.query("SELECT id FROM activities WHERE id=$1 FOR UPDATE", [f.activity.id]);
  const work = processActivityReminder(h.db, f.activity.id, f.intent.generationId, signal());
  const settled = work.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  try {
    await blockedBy(await observerPid());
    await observer.query("UPDATE activities SET done=true,done_at=clock_timestamp() WHERE id=$1", [
      f.activity.id,
    ]);
    await observer.query("COMMIT");
    expect(await settled).toMatchObject({ value: { state: "cancelled" } });
    expect((await currentIntent(f.activity.id)).status).toBe("cancelled");
    expect(await h.db.select().from(notifications)).toHaveLength(0);
  } finally {
    await observer.query("ROLLBACK");
    await settled;
  }
});
it("a real interrupted insert rolls back notification and receipt before a current retry recovers", async () => {
  const f = await fixture();
  await observer.query("BEGIN");
  await observer.query("SELECT pg_advisory_xact_lock(907,1)");
  await h.pool.query(
    `CREATE FUNCTION calendar_test_insert_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(907,1); RETURN NEW; END $$`,
  );
  await h.pool.query(
    `CREATE TRIGGER calendar_test_insert_gate BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION calendar_test_insert_gate()`,
  );
  const work = processActivityReminder(h.db, f.activity.id, f.intent.generationId, signal());
  const settled = work.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  try {
    const pid = await blockedBy(await observerPid());
    // This PID is the exact test-owned backend blocked by our insert gate in
    // this unique clone. No other backend or process is cancelled.
    expect(
      (
        await observer.query<{ cancelled: boolean }>("SELECT pg_cancel_backend($1) AS cancelled", [
          pid,
        ])
      ).rows[0]?.cancelled,
    ).toBe(true);
    await observer.query("COMMIT");
    expect(await settled).toHaveProperty("error");
    expect(await h.db.select().from(notifications)).toHaveLength(0);
    const failed = await currentIntent(f.activity.id);
    expect(failed).toMatchObject({
      status: "failed",
      notificationId: null,
      generationId: f.intent.generationId,
    });
    expect(
      (
        await withCurrentAuthority(h.db, "read", signal(), (tx) =>
          retryActivityReminder(tx, f.actor, f.activity.id, failed.generationId, signal()),
        )
      ).ok,
    ).toBe(true);
    expect(
      (await processActivityReminder(h.db, f.activity.id, failed.generationId, signal())).state,
    ).toBe("delivered");
    expect(await h.db.select().from(notifications)).toHaveLength(1);
  } finally {
    await observer.query("ROLLBACK");
    await settled;
  }
});
it("an older deferred failure cannot downgrade a newer explicit retry", async () => {
  const f = await fixture();
  const previousAttempt = randomUUID();
  await h.db
    .update(activityReminderIntents)
    .set({ status: "failed", attemptCount: 1, attemptVersion: previousAttempt })
    .where(eq(activityReminderIntents.activityId, f.activity.id));
  await observer.query("BEGIN");
  await observer.query("SELECT pg_advisory_xact_lock(907,2)");
  await h.pool.query(
    `CREATE FUNCTION calendar_test_retry_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(907,2); RETURN NEW; END $$`,
  );
  await h.pool.query(
    `CREATE TRIGGER calendar_test_retry_gate BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION calendar_test_retry_gate()`,
  );
  const work = processActivityReminder(h.db, f.activity.id, f.intent.generationId, signal());
  const settled = work.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  let retry: Promise<unknown> | undefined;
  try {
    const workerPid = await blockedBy(await observerPid());
    retry = withCurrentAuthority(h.db, "read", signal(), (tx) =>
      retryActivityReminder(tx, f.actor, f.activity.id, f.intent.generationId, signal()),
    );
    await blockedBy(workerPid);
    await observer.query("SELECT pg_cancel_backend($1)", [workerPid]);
    expect(await retry).toEqual({ ok: true, value: { id: f.activity.id } });
    await observer.query("COMMIT");
    expect(await settled).toHaveProperty("error");
    const current = await currentIntent(f.activity.id);
    expect(current).toMatchObject({ status: "pending", attemptCount: 1, lastErrorId: null });
    expect(current.attemptVersion).not.toBe(previousAttempt);
    expect(await h.db.select().from(notifications)).toHaveLength(0);
    expect(
      (await processActivityReminder(h.db, f.activity.id, current.generationId, signal())).state,
    ).toBe("delivered");
    expect(await h.db.select().from(notifications)).toHaveLength(1);
  } finally {
    await observer.query("ROLLBACK");
    await settled;
    await retry;
  }
});
