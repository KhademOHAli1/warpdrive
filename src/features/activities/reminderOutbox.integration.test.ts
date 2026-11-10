import { eq, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { EMAIL_NOTIFICATION_QUEUE, PGBOSS_QUEUE_ACTIVITY_REMINDER } from "@/constants/jobNames";
import { activities, calendarReminderIntents, activityTypes, notifications } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { makeTestDb } from "@/test/db";
import { dispatchReminderIntents } from "./reminderOutbox";
import { handleReminderJob } from "./reminders";
import { createActivity } from "./repo";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
let boss: PgBoss;
const signal = () => AbortSignal.timeout(10_000);
beforeEach(async () => {
  ctx = await makeTestDb();
  boss = new PgBoss(ctx.url);
  await boss.start();
});
afterEach(async () => {
  await boss.stop();
  await ctx.close();
});
async function fixture() {
  const user = await seedUser(ctx.db, { isAdmin: true });
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "seed absent");
  const result = await createActivity(
    ctx.db,
    { id: user.id, type: "admin", isActive: true, flags: new Set(), groupIds: new Set() },
    {
      typeId: type.id,
      subject: "یادآوری / Erinnerung",
      dueAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    },
    signal(),
  );
  if (!result.ok) throw result.error;
  const [intent] = await ctx.db
    .select()
    .from(calendarReminderIntents)
    .where(eq(calendarReminderIntents.activityId, result.value.id));
  if (intent === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "intent absent");
  return { activity: result.value, intent };
}
const notes = () => ctx.db.select().from(notifications);
const stored = async (id: string) =>
  (
    await ctx.db.select().from(calendarReminderIntents).where(eq(calendarReminderIntents.id, id))
  )[0];

it("recovers enqueue-before-mark crashes with the same job UUID and one notification", async () => {
  const { intent } = await fixture();
  await boss.createQueue(PGBOSS_QUEUE_ACTIVITY_REMINDER);
  await boss.createQueue(EMAIL_NOTIFICATION_QUEUE);
  await boss.send(
    PGBOSS_QUEUE_ACTIVITY_REMINDER,
    { intentId: intent.id },
    { id: intent.id, startAfter: intent.fireAt },
  );
  await Promise.all([
    dispatchReminderIntents(ctx.db, boss, signal()),
    dispatchReminderIntents(ctx.db, boss, signal()),
  ]);
  const jobs = await ctx.pool.query("SELECT id FROM pgboss.job WHERE name=$1", [
    PGBOSS_QUEUE_ACTIVITY_REMINDER,
  ]);
  expect(jobs.rows).toEqual([{ id: intent.id }]);
  expect((await stored(intent.id))?.state).toBe("dispatched");
  await Promise.all([
    handleReminderJob(ctx.db, { data: { intentId: intent.id } }, signal(), boss),
    handleReminderJob(ctx.db, { data: { intentId: intent.id } }, signal(), boss),
  ]);
  expect(await notes()).toHaveLength(1);
  expect((await stored(intent.id))?.notificationId).toBe((await notes())[0]?.id);
  expect((await stored(intent.id))?.emailEnqueuedAt).not.toBeNull();
});

it("retains one committed notification and retries email handoff after the email queue recovers", async () => {
  const { intent } = await fixture();
  await expect(
    handleReminderJob(ctx.db, { data: { intentId: intent.id } }, signal(), boss),
  ).rejects.toMatchObject({ code: "PGBOSS_QUEUE_NOT_FOUND" });
  expect(await notes()).toHaveLength(1);
  expect((await stored(intent.id))?.state).toBe("delivered");
  expect((await stored(intent.id))?.emailEnqueuedAt).toBeNull();
  await boss.createQueue(EMAIL_NOTIFICATION_QUEUE);
  await dispatchReminderIntents(ctx.db, boss, signal());
  await dispatchReminderIntents(ctx.db, boss, signal());
  expect(await notes()).toHaveLength(1);
  const emailJobs = await ctx.pool.query("SELECT id FROM pgboss.job WHERE name=$1", [
    EMAIL_NOTIFICATION_QUEUE,
  ]);
  expect(emailJobs.rows).toEqual([{ id: (await notes())[0]?.id }]);
});

it("rolls notification and delivery marker back together when delivery persistence fails", async () => {
  const { intent } = await fixture();
  await ctx.db.execute(
    sql`CREATE FUNCTION reject_delivery_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state = 'delivered' THEN RAISE EXCEPTION 'synthetic delivery marker failure'; END IF; RETURN NEW; END $$`,
  );
  await ctx.db.execute(
    sql`CREATE TRIGGER reject_delivery_test BEFORE UPDATE ON calendar_reminder_intents FOR EACH ROW EXECUTE FUNCTION reject_delivery_test()`,
  );
  await expect(
    handleReminderJob(ctx.db, { data: { intentId: intent.id } }, signal(), boss),
  ).rejects.toBeDefined();
  expect(await notes()).toHaveLength(0);
  expect((await stored(intent.id))?.state).toBe("pending");
  await ctx.db.execute(sql`DROP TRIGGER reject_delivery_test ON calendar_reminder_intents`);
  await ctx.db.execute(sql`DROP FUNCTION reject_delivery_test()`);
  await boss.createQueue(EMAIL_NOTIFICATION_QUEUE);
  await handleReminderJob(ctx.db, { data: { intentId: intent.id } }, signal(), boss);
  expect(await notes()).toHaveLength(1);
});

it.each(["reschedule", "complete", "delete", "assignee", "undate"] as const)(
  "suppresses stale jobs after legacy %s writes",
  async (kind) => {
    const { activity, intent } = await fixture();
    const other = await seedUser(ctx.db);
    const patch =
      kind === "reschedule"
        ? { dueAt: new Date(Date.now() + 60 * 60_000) }
        : kind === "complete"
          ? { done: true }
          : kind === "delete"
            ? { deletedAt: new Date() }
            : kind === "assignee"
              ? { assigneeId: other.id }
              : { dueAt: null };
    await ctx.db.update(activities).set(patch).where(eq(activities.id, activity.id));
    await handleReminderJob(ctx.db, { data: { intentId: intent.id } }, signal(), boss);
    expect(await notes()).toHaveLength(0);
    expect((await stored(intent.id))?.state).toBe("cancelled");
  },
);

it("does not deliver a future reminder early or accept an unsafe legacy activity-only payload", async () => {
  const { activity, intent } = await fixture();
  await ctx.db
    .update(calendarReminderIntents)
    .set({ fireAt: new Date(Date.now() + 60_000) })
    .where(eq(calendarReminderIntents.id, intent.id));
  await handleReminderJob(ctx.db, { data: { intentId: intent.id } }, signal(), boss);
  await handleReminderJob(ctx.db, { data: { activityId: activity.id } }, signal(), boss);
  expect(await notes()).toHaveLength(0);
});
