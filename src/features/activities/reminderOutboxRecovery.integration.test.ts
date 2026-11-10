import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { EMAIL_NOTIFICATION_QUEUE, PGBOSS_QUEUE_ACTIVITY_REMINDER } from "@/constants/jobNames";
import { activityReminderIntents, activityTypes, notifications } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import { dispatchReminderIntents } from "./reminderOutbox";
import { handleReminderJob } from "./reminders";
import { completeActivity, createActivity } from "./repo";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
let boss: PgBoss;
const signal = () => AbortSignal.timeout(10_000);
beforeEach(async () => {
  ctx = await makeTestDb();
  boss = new PgBoss(ctx.url);
  await boss.start();
  await boss.createQueue(PGBOSS_QUEUE_ACTIVITY_REMINDER);
  await boss.createQueue(EMAIL_NOTIFICATION_QUEUE);
});
afterEach(async () => {
  await boss.stop();
  await ctx.close();
});

async function fixture() {
  const user = await seedUser(ctx.db, { isAdmin: true });
  const actor: PermSetUser = {
    id: user.id,
    type: "admin" as const,
    isActive: true,
    flags: new Set(),
    groupIds: new Set<string>(),
  };
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "meeting seed absent");
  const result = await createActivity(
    ctx.db,
    actor,
    {
      typeId: type.id,
      subject: "بازیابی یادآوری / Wiederherstellung",
      dueAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    },
    signal(),
  );
  if (!result.ok) throw result.error;
  const [intent] = await ctx.db
    .update(activityReminderIntents)
    .set({ state: "dispatched", dispatchedAt: new Date(Date.now() - 60_000) })
    .where(eq(activityReminderIntents.activityId, result.value.id))
    .returning();
  if (intent === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "intent absent");
  await boss.send(
    PGBOSS_QUEUE_ACTIVITY_REMINDER,
    { intentId: intent.id },
    { id: intent.id, retryLimit: 0 },
  );
  return { actor, activity: result.value, intent };
}

async function jobs() {
  return (
    await ctx.pool.query<{ id: string }>("SELECT id FROM pgboss.job WHERE name=$1", [
      PGBOSS_QUEUE_ACTIVITY_REMINDER,
    ])
  ).rows;
}

it.each(["failed", "deleted", "cancelled"] as const)(
  "recovers an undelivered intent after its queue job is %s without changing its logical UUID",
  async (state) => {
    const { intent } = await fixture();
    if (state === "failed") await boss.fail(PGBOSS_QUEUE_ACTIVITY_REMINDER, intent.id);
    if (state === "deleted") await boss.deleteJob(PGBOSS_QUEUE_ACTIVITY_REMINDER, intent.id);
    if (state === "cancelled") await boss.cancel(PGBOSS_QUEUE_ACTIVITY_REMINDER, intent.id);
    expect((await boss.getJobById(PGBOSS_QUEUE_ACTIVITY_REMINDER, intent.id))?.state ?? null).toBe(
      state === "deleted" ? null : state,
    );
    await Promise.all([
      dispatchReminderIntents(ctx.db, boss, signal()),
      dispatchReminderIntents(ctx.db, boss, signal()),
    ]);
    const [job] = await boss.fetch<{ intentId: string }>(PGBOSS_QUEUE_ACTIVITY_REMINDER);
    expect(job?.id).toBe(intent.id);
    if (job === undefined) return;
    await handleReminderJob(ctx.db, job, signal(), boss);
    await boss.complete(PGBOSS_QUEUE_ACTIVITY_REMINDER, job);
    await dispatchReminderIntents(ctx.db, boss, signal());
    expect(await jobs()).toEqual([{ id: intent.id }]);
    expect(await ctx.db.select().from(notifications)).toHaveLength(1);
  },
);

it("requeues premature completed work only once the authoritative reminder fire time arrives", async () => {
  const { intent } = await fixture();
  await ctx.db
    .update(activityReminderIntents)
    .set({ fireAt: new Date(Date.now() + 60_000) })
    .where(eq(activityReminderIntents.id, intent.id));
  const [early] = await boss.fetch<{ intentId: string }>(PGBOSS_QUEUE_ACTIVITY_REMINDER);
  if (early === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "early job absent");
  await handleReminderJob(ctx.db, early, signal(), boss);
  await boss.complete(PGBOSS_QUEUE_ACTIVITY_REMINDER, early);
  await dispatchReminderIntents(ctx.db, boss, signal());
  expect((await boss.getJobById(PGBOSS_QUEUE_ACTIVITY_REMINDER, intent.id))?.state).toBe(
    "completed",
  );
  expect(await ctx.db.select().from(notifications)).toHaveLength(0);
  await ctx.db
    .update(activityReminderIntents)
    .set({ fireAt: new Date(Date.now() - 1000) })
    .where(eq(activityReminderIntents.id, intent.id));
  await dispatchReminderIntents(ctx.db, boss, signal());
  const [recovered] = await boss.fetch<{ intentId: string }>(PGBOSS_QUEUE_ACTIVITY_REMINDER);
  expect(recovered?.id).toBe(intent.id);
  if (recovered === undefined) return;
  await handleReminderJob(ctx.db, recovered, signal(), boss);
  expect(await jobs()).toEqual([{ id: intent.id }]);
  expect(await ctx.db.select().from(notifications)).toHaveLength(1);
});

it("leaves live attempts alone and never resurrects an authoritatively cancelled intent", async () => {
  const { actor, activity, intent } = await fixture();
  const [job] = await boss.fetch(PGBOSS_QUEUE_ACTIVITY_REMINDER);
  if (job === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "active job absent");
  await dispatchReminderIntents(ctx.db, boss, signal());
  expect((await boss.getJobById(PGBOSS_QUEUE_ACTIVITY_REMINDER, intent.id))?.state).toBe("active");
  expect((await boss.getJobById(PGBOSS_QUEUE_ACTIVITY_REMINDER, intent.id))?.retryCount).toBe(0);
  await completeActivity(ctx.db, actor, activity.id, true, signal());
  await boss.deleteJob(PGBOSS_QUEUE_ACTIVITY_REMINDER, intent.id);
  await dispatchReminderIntents(ctx.db, boss, signal());
  expect(await jobs()).toEqual([]);
  expect(await ctx.db.select().from(notifications)).toHaveLength(0);
});

it("bounds recovery batches and rotates live jobs so later missing jobs cannot starve", async () => {
  const { intent } = await fixture();
  await ctx.db.insert(activityReminderIntents).values(
    Array.from({ length: 100 }, () => ({
      activityId: intent.activityId,
      assigneeId: intent.assigneeId,
      dueAt: intent.dueAt,
      fireAt: intent.fireAt,
      state: "dispatched" as const,
      dispatchedAt: new Date("2020-01-01T00:00:00Z"),
    })),
  );
  await boss.deleteJob(PGBOSS_QUEUE_ACTIVITY_REMINDER, intent.id);
  await dispatchReminderIntents(ctx.db, boss, signal());
  expect(await jobs()).toHaveLength(100);
  await dispatchReminderIntents(ctx.db, boss, signal());
  expect(await jobs()).toHaveLength(101);
});
