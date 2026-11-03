import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { expect, it } from "vitest";
import { EMAIL_NOTIFICATION_QUEUE, PGBOSS_QUEUE_ACTIVITY_REMINDER } from "@/constants/jobNames";
import { activities, activityTypes, notifications, sessions } from "@/db/schema";
import { activityReminderIntents } from "@/db/schema/activityReminderIntents";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { NATIVE_ACTIVITY_REMINDER_QUEUE, reconcileActivityReminders } from "./reminderScheduling";
import { registerReminderWorker } from "./reminders";
import { createActivity } from "./repo";

// Real pg-boss + real production registration/consumer in one owned clone.
// No fake boss, provider call, global requireBoss installation or app process.
it("recovers committed due intent on real worker boot/restart, suppresses duplicate nudges, and queues no email", async () => {
  const h = await makeTestDb();
  const instances: PgBoss[] = [];
  const errors: unknown[] = [];
  const signal = () => AbortSignal.timeout(10_000);
  async function startWorker() {
    const boss = new PgBoss({ connectionString: h.url, schema: "calendar_jobs", max: 4 });
    instances.push(boss);
    boss.on("error", (error) => {
      errors.push(error);
    });
    await boss.start();
    await registerReminderWorker(boss, h.db);
    return boss;
  }
  async function waitDelivered(activityId: string) {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const [row] = await h.db
        .select()
        .from(activityReminderIntents)
        .where(eq(activityReminderIntents.activityId, activityId));
      if (row?.status === "delivered") return row;
      if (row?.status === "failed" || row?.status === "suppressed")
        throw new Error(`Unexpected worker outcome ${row.status}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Real Calendar worker did not acknowledge due intent");
  }
  try {
    const user = await seedUser(h.db, { isAdmin: true });
    const actor = await hydrateActor(h.db, user.id, signal());
    if (actor === null) throw new Error("Worker recipient fixture missing");
    // Expiry of the author's interactive session cannot make an otherwise
    // currently authorized background recipient depend on a fabricated session.
    await h.db.insert(sessions).values({
      userId: user.id,
      tokenHash: "expired-worker-fixture",
      expiresAt: sql`clock_timestamp() - interval '1 day'`,
    });
    const [type] = await h.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
    if (type === undefined) throw new Error("Meeting fixture missing");
    const workerActor = actor;
    const typeId = type.id;
    async function createDue(subject: string) {
      const clock = await h.db.execute<{ due: Date | string; end: Date | string }>(
        sql`SELECT clock_timestamp()+interval '5 minutes' AS due, clock_timestamp()+interval '65 minutes' AS "end"`,
      );
      const row = clock.rows[0];
      if (row === undefined) throw new Error("Worker DB clock missing");
      const created = await createActivity(
        h.db,
        workerActor,
        {
          typeId,
          subject,
          dueAt: new Date(row.due).toISOString(),
          endAt: new Date(row.end).toISOString(),
          durationMinutes: 60,
          authoredTimeZone: "UTC",
          reminderTimeZone: "UTC",
          reminder: { kind: "before_start", channel: "in_app", leadMinutes: 10 },
        },
        signal(),
      );
      if (!created.ok) throw created.error;
      return created.value.id;
    }
    const first = await createDue("Saved while worker unavailable");
    expect(await h.db.select().from(notifications)).toHaveLength(0);
    const firstBoss = await startWorker();
    const receipt = await waitDelivered(first);
    expect(receipt.attemptCount).toBe(1);
    const duplicate = await firstBoss.send(NATIVE_ACTIVITY_REMINDER_QUEUE, {
      v: 1,
      activityId: first,
      generationId: receipt.generationId,
    });
    const legacy = await firstBoss.send(PGBOSS_QUEUE_ACTIVITY_REMINDER, { activityId: first });
    if (duplicate === null || legacy === null)
      throw new Error("Duplicate control jobs were not admitted");
    const settled = Date.now() + 5_000;
    let completed = false;
    while (Date.now() < settled) {
      const row = await h.pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM calendar_jobs.job WHERE id=ANY($1::uuid[]) AND state='completed'`,
        [[duplicate, legacy]],
      );
      if (row.rows[0]?.count === 2) {
        completed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(completed).toBe(true);
    await firstBoss.stop({ graceful: true, timeout: 2_500 });
    instances.splice(instances.indexOf(firstBoss), 1);
    const second = await createDue("Saved before worker restart");
    await startWorker();
    const secondReceipt = await waitDelivered(second);
    const notes = await h.db.select().from(notifications);
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((note) => note.id))).toEqual(
      new Set([receipt.notificationId, secondReceipt.notificationId]),
    );
    const emailJobs = await h.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM calendar_jobs.job WHERE name=$1`,
      [EMAIL_NOTIFICATION_QUEUE],
    );
    expect(emailJobs.rows[0]?.count).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    for (const boss of instances) await boss.stop({ graceful: true, timeout: 2_500 });
    await h.close();
  }
}, 30_000);

it("bounds recovery without letting deferred older failures starve an already eligible reminder", async () => {
  const h = await makeTestDb();
  const boss = new PgBoss({ connectionString: h.url, schema: "calendar_fairness", max: 2 });
  const errors: unknown[] = [];
  boss.on("error", (error) => {
    errors.push(error);
  });
  const signal = () => AbortSignal.timeout(10_000);
  try {
    const user = await seedUser(h.db);
    const [type] = await h.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
    if (type === undefined) throw new Error("Fairness type missing");
    const clock = await h.pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const now = clock.rows[0]?.now.getTime();
    if (now === undefined) throw new Error("Fairness DB clock missing");
    const pendingId = randomUUID();
    const failures = Array.from({ length: 100 }, () => randomUUID());
    await h.db.insert(activities).values([
      ...failures.map((id) => ({
        id,
        typeId: type.id,
        subject: "Deferred earlier failure",
        ownerId: user.id,
        assigneeId: user.id,
        dueAt: new Date(now - 600_000),
        endAt: new Date(now + 3_000_000),
      })),
      {
        id: pendingId,
        typeId: type.id,
        subject: "Eligible pending reminder",
        ownerId: user.id,
        assigneeId: user.id,
        dueAt: new Date(now + 300_000),
        endAt: new Date(now + 3_900_000),
      },
    ]);
    await h.db.insert(activityReminderIntents).values([
      ...failures.map((activityId) => ({
        activityId,
        managed: true,
        status: "failed",
        attemptCount: 1,
        eventTimeZone: "UTC",
        reminderTimeZone: "UTC",
        selection: { kind: "before_start", channel: "in_app", leadMinutes: 10 },
        fireAt: new Date(now - 1_200_000),
        nextAttemptAt: new Date(now - 60_000),
      })),
      {
        activityId: pendingId,
        managed: true,
        status: "pending",
        eventTimeZone: "UTC",
        reminderTimeZone: "UTC",
        selection: { kind: "before_start", channel: "in_app", leadMinutes: 10 },
        fireAt: new Date(now - 300_000),
      },
    ]);
    await boss.start();
    await boss.createQueue(NATIVE_ACTIVITY_REMINDER_QUEUE);
    // No worker consumes the jobs while we inspect actual admitted queue data.
    await reconcileActivityReminders(h.db, boss, signal());
    const admitted = await h.pool.query<{ activity_id: string }>(
      `SELECT data->>'activityId' AS activity_id FROM calendar_fairness.job WHERE name=$1`,
      [NATIVE_ACTIVITY_REMINDER_QUEUE],
    );
    console.warn("Calendar recovery admission control", {
      admittedCount: admitted.rows.length,
      pendingIncluded: admitted.rows.some((row) => row.activity_id === pendingId),
      deferredFailureFixtures: failures.length,
    });
    expect(admitted.rows).toHaveLength(100);
    expect(admitted.rows.map((row) => row.activity_id)).toContain(pendingId);
    expect(errors).toEqual([]);
  } finally {
    await boss.stop({ graceful: true, timeout: 2_500 });
    await h.close();
  }
}, 20_000);
