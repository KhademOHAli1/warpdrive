import { and, eq, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { activities, activityReminderIntents, activityTypes } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { setBoss } from "@/jobs/boss";
import { makeTestDb } from "@/test/db";
import { deleteActivity } from "./activityDelete";
import { updateActivity } from "./activityUpdate";
import { completeActivity, createActivity } from "./repo";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
let boss: PgBoss;
const signal = () => AbortSignal.timeout(10_000);
beforeAll(async () => {
  ctx = await makeTestDb();
  boss = new PgBoss(ctx.url);
  await boss.start();
  setBoss(boss);
});
afterAll(async () => {
  setBoss(null);
  await boss.stop();
  await ctx.close();
});
async function event() {
  const user = await seedUser(ctx.db, { isAdmin: true });
  const actor: PermSetUser = {
    id: user.id,
    type: "admin",
    isActive: true,
    flags: new Set(),
    groupIds: new Set(),
  };
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "seed type missing");
  const result = await createActivity(
    ctx.db,
    actor,
    {
      subject: "رویداد بدون صف / Neuer Termin",
      typeId: type.id,
      dueAt: "2030-03-21T09:00:00Z",
    },
    signal(),
  );
  if (!result.ok) throw result.error;
  return { actor, row: result.value };
}
const intents = (id: string) =>
  ctx.db.select().from(activityReminderIntents).where(eq(activityReminderIntents.activityId, id));

it("saves exactly one event and durable 10-minute intent with no reminder worker or queue", async () => {
  const { row } = await event();
  expect(await boss.getQueue("activity.reminder")).toBeNull();
  const [intent] = await intents(row.id);
  expect(intent).toMatchObject({
    activityId: row.id,
    assigneeId: row.assigneeId,
    state: "pending",
    notificationId: null,
  });
  expect(intent?.dueAt.toISOString()).toBe("2030-03-21T09:00:00.000Z");
  expect(intent?.fireAt.toISOString()).toBe("2030-03-21T08:50:00.000Z");
  expect(await ctx.db.select().from(activities).where(eq(activities.id, row.id))).toHaveLength(1);
});

it("rolls the event back if durable reminder persistence fails", async () => {
  await ctx.db.execute(
    sql`CREATE FUNCTION reject_reminder_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic intent storage failure'; END $$`,
  );
  await ctx.db.execute(
    sql`CREATE TRIGGER reject_reminder_test BEFORE INSERT ON activity_reminder_intents FOR EACH ROW EXECUTE FUNCTION reject_reminder_test()`,
  );
  const before = await ctx.db.select({ id: activities.id }).from(activities);
  try {
    await expect(event()).rejects.toMatchObject({
      cause: { message: "synthetic intent storage failure" },
    });
    expect(await ctx.db.select({ id: activities.id }).from(activities)).toHaveLength(before.length);
  } finally {
    await ctx.db.execute(sql`DROP TRIGGER reject_reminder_test ON activity_reminder_intents`);
    await ctx.db.execute(sql`DROP FUNCTION reject_reminder_test()`);
  }
});

it("cancels an obsolete intent on reschedule and keeps the replacement stable on unrelated edits", async () => {
  const { actor, row } = await event();
  await updateActivity(ctx.db, actor, { id: row.id, dueAt: "2030-03-22T10:00:00Z" }, signal());
  const reminders = await intents(row.id);
  expect(reminders.filter((r) => r.state === "cancelled")).toHaveLength(1);
  const active = reminders.filter((r) => r.state === "pending");
  expect(active).toHaveLength(1);
  expect(active[0]?.dueAt.toISOString()).toBe("2030-03-22T10:00:00.000Z");
  await updateActivity(ctx.db, actor, { id: row.id, subject: "Geändert" }, signal());
  expect(await intents(row.id)).toHaveLength(2);
});

it.each(["complete", "delete", "undate"] as const)(
  "cancels outstanding intent on %s",
  async (operation) => {
    const { actor, row } = await event();
    if (operation === "complete") await completeActivity(ctx.db, actor, row.id, true, signal());
    if (operation === "delete") await deleteActivity(ctx.db, actor, row.id, signal());
    if (operation === "undate")
      await updateActivity(ctx.db, actor, { id: row.id, dueAt: null }, signal());
    expect(await intents(row.id)).toMatchObject([{ state: "cancelled" }]);
    if (operation === "complete") {
      await completeActivity(ctx.db, actor, row.id, false, signal());
      expect(
        await ctx.db
          .select()
          .from(activityReminderIntents)
          .where(
            and(
              eq(activityReminderIntents.activityId, row.id),
              eq(activityReminderIntents.state, "pending"),
            ),
          ),
      ).toHaveLength(1);
    }
  },
);
