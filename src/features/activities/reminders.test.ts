import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { PGBOSS_QUEUE_ACTIVITY_REMINDER, PGBOSS_QUEUE_REMINDER_OUTBOX } from "@/constants/jobNames";
import {
  activities,
  activityReminderIntents,
  activityTypes,
  deals,
  notifications,
} from "@/db/schema";
import type { Activity } from "@/db/schema/activities";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { reconcileReminderIntent } from "./reminderIntent";
import { handleReminderJob, registerReminderWorker } from "./reminders";

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0];
async function reminderJob(db: TestDb, activity: Activity) {
  await reconcileReminderIntent(db, activity, new AbortController().signal);
  const [intent] = await db
    .select()
    .from(activityReminderIntents)
    .where(eq(activityReminderIntents.activityId, activity.id));
  if (intent === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "reminder intent not seeded");
  return { data: { intentId: intent.id } };
}

// ---------------------------------------------------------------------------
// handleReminderJob
// ---------------------------------------------------------------------------

it("fires a notification for an open activity and skips a completed one", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);

    const [type] = await db.select().from(activityTypes).where(eq(activityTypes.key, "task"));
    if (type === undefined) throw new Error("activity type 'task' not found");

    const [open] = await db
      .insert(activities)
      .values({
        typeId: type.id,
        reminderEngine: "intent",
        subject: "Open task",
        ownerId: user.id,
        assigneeId: user.id,
        dueAt: new Date("2026-07-02T10:00:00Z"),
      })
      .returning();
    if (open === undefined) throw new Error("open activity insert failed");

    const [done] = await db
      .insert(activities)
      .values({
        typeId: type.id,
        reminderEngine: "intent",
        subject: "Done task",
        ownerId: user.id,
        assigneeId: user.id,
        dueAt: new Date("2026-07-02T10:00:00Z"),
      })
      .returning();
    if (done === undefined) throw new Error("done activity insert failed");

    const openJob = await reminderJob(db, open);
    const doneJob = await reminderJob(db, done);
    await db
      .update(activities)
      .set({ done: true, doneAt: new Date() })
      .where(eq(activities.id, done.id));
    await handleReminderJob(db, openJob, new AbortController().signal, null);
    await handleReminderJob(db, doneJob, new AbortController().signal, null);

    const notes = await db.select().from(notifications).where(eq(notifications.userId, user.id));
    const subjects = notes.map((n) => (n.payload as { subject?: string }).subject);
    expect(subjects).toContain("Open task");
    expect(subjects).not.toContain("Done task");
  });
});

it("inserts no notification for a done activity (done-skip guard)", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);

    const [type] = await db.select().from(activityTypes).where(eq(activityTypes.key, "task"));
    if (type === undefined) throw new Error("activity type 'task' not found");

    const [done] = await db
      .insert(activities)
      .values({
        typeId: type.id,
        reminderEngine: "intent",
        subject: "Already done",
        ownerId: user.id,
        assigneeId: user.id,
        dueAt: new Date("2026-07-02T10:00:00Z"),
      })
      .returning();
    if (done === undefined) throw new Error("done activity insert failed");

    const doneJob = await reminderJob(db, done);
    await db
      .update(activities)
      .set({ done: true, doneAt: new Date() })
      .where(eq(activities.id, done.id));
    await handleReminderJob(db, doneJob, new AbortController().signal, null);

    const notes = await db.select().from(notifications).where(eq(notifications.userId, user.id));
    expect(notes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Notification target: the reminder must point at something the UI can open.
// ---------------------------------------------------------------------------

it("targets the activity's parent deal, not the activity id", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { pipeline, stages } = await seedPipelineWithStages(db, ["Qualified"]);
    const stage = stages[0];
    if (stage === undefined) throw new Error("stage seed failed");

    const [deal] = await db
      .insert(deals)
      .values({
        title: "Acme",
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: user.id,
        visibilityLevel: "all",
      })
      .returning();
    if (deal === undefined) throw new Error("deal insert failed");

    const [type] = await db.select().from(activityTypes).where(eq(activityTypes.key, "task"));
    if (type === undefined) throw new Error("activity type 'task' not found");

    const [activity] = await db
      .insert(activities)
      .values({
        typeId: type.id,
        reminderEngine: "intent",
        subject: "Meeting",
        ownerId: user.id,
        assigneeId: user.id,
        dealId: deal.id,
        dueAt: new Date("2026-07-02T10:00:00Z"),
      })
      .returning();
    if (activity === undefined) throw new Error("activity insert failed");

    await handleReminderJob(
      db,
      await reminderJob(db, activity),
      new AbortController().signal,
      null,
    );

    const [note] = await db.select().from(notifications).where(eq(notifications.userId, user.id));
    if (note === undefined) throw new Error("no notification produced");

    // Storing the activity id under entityType "activity" made the bell build /deals/<activityId>,
    // which always rendered Not found.
    expect(note.entityType).toBe("deal");
    expect(note.entityId).toBe(deal.id);
    expect((note.payload as { activityId?: string }).activityId).toBe(activity.id);
  });
});

it("leaves the target null for a parentless activity rather than pointing at the activity", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);

    const [type] = await db.select().from(activityTypes).where(eq(activityTypes.key, "task"));
    if (type === undefined) throw new Error("activity type 'task' not found");

    const [activity] = await db
      .insert(activities)
      .values({
        typeId: type.id,
        reminderEngine: "intent",
        subject: "Standalone",
        ownerId: user.id,
        assigneeId: user.id,
        dueAt: new Date("2026-07-02T10:00:00Z"),
      })
      .returning();
    if (activity === undefined) throw new Error("activity insert failed");

    await handleReminderJob(
      db,
      await reminderJob(db, activity),
      new AbortController().signal,
      null,
    );

    const [note] = await db.select().from(notifications).where(eq(notifications.userId, user.id));
    if (note === undefined) throw new Error("no notification produced");

    expect(note.entityType).toBeNull();
    expect(note.entityId).toBeNull();
    expect((note.payload as { activityId?: string }).activityId).toBe(activity.id);
  });
});

// ---------------------------------------------------------------------------
// registerReminderWorker (DB-free: recording fake boss)
// ---------------------------------------------------------------------------

interface QueueRecord {
  name: string;
}
interface WorkRecord {
  name: string;
}
interface ScheduleRecord {
  name: string;
  cron: string;
}
interface SendRecord {
  name: string;
  data: object;
}

function makeFakeBoss() {
  const queues: QueueRecord[] = [];
  const workers: WorkRecord[] = [];
  const schedules: ScheduleRecord[] = [];
  const sends: SendRecord[] = [];

  return {
    queues,
    workers,
    schedules,
    sends,
    createQueue(name: string): Promise<void> {
      queues.push({ name });
      return Promise.resolve();
    },
    work(name: string, handler: unknown): Promise<void> {
      void handler;
      workers.push({ name });
      return Promise.resolve();
    },
    schedule(name: string, cron: string): Promise<void> {
      schedules.push({ name, cron });
      return Promise.resolve();
    },
    send(name: string, data: object): Promise<null> {
      sends.push({ name, data });
      return Promise.resolve(null);
    },
  };
}

describe("registerReminderWorker", () => {
  it("registers reminder delivery and schedules a durable outbox sweep with an initial dispatch", async () => {
    const fakeBoss = makeFakeBoss();

    await registerReminderWorker(
      fakeBoss as unknown as Parameters<typeof registerReminderWorker>[0],
    );

    const queueNames = fakeBoss.queues.map((q) => q.name);
    expect(queueNames).toEqual([PGBOSS_QUEUE_ACTIVITY_REMINDER, PGBOSS_QUEUE_REMINDER_OUTBOX]);

    const workerNames = fakeBoss.workers.map((w) => w.name);
    expect(workerNames).toEqual([PGBOSS_QUEUE_ACTIVITY_REMINDER, PGBOSS_QUEUE_REMINDER_OUTBOX]);
    expect(fakeBoss.schedules).toEqual([{ name: PGBOSS_QUEUE_REMINDER_OUTBOX, cron: "* * * * *" }]);
    expect(fakeBoss.sends).toEqual([{ name: PGBOSS_QUEUE_REMINDER_OUTBOX, data: {} }]);
  });
});
