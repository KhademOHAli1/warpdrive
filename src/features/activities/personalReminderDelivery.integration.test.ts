import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  activities,
  activityReminderIntents,
  activityReminderSettings,
  activityTypes,
  calendarReminderDefaults,
  notifications,
  reminderRebuilds,
} from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import { createCalendar, setCalendarMember } from "./calendars";
import { reconcileReminderIntent } from "./reminderIntent";
import { DEFAULT_REMINDER_RULES } from "./reminderPolicy";
import { handleReminderJob } from "./reminders";
import { createActivity } from "./repo";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
const signal = () => AbortSignal.timeout(10_000);
beforeAll(async () => {
  ctx = await makeTestDb();
});
afterAll(async () => {
  await ctx.close();
});
async function fixture(allDay = false) {
  const user = await seedUser(ctx.db, { isAdmin: true });
  const actor: PermSetUser = {
    id: user.id,
    type: "admin",
    isActive: true,
    flags: new Set(),
    groupIds: new Set(),
  };
  const cal = await createCalendar(
    ctx.db,
    actor,
    { name: "یادآوری / Erinnerungen", timeZone: "Asia/Tehran" },
    signal(),
  );
  if (!cal.ok) throw cal.error;
  const [type] = await ctx.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "seed missing");
  const result = await createActivity(
    ctx.db,
    actor,
    {
      typeId: type.id,
      subject: "Personal",
      calendarId: cal.value.id,
      eventTimeZone: "Asia/Tehran",
      dueAt: "2027-03-21T05:30:00.000Z",
      allDay,
      ...(allDay ? { dueDate: "2027-03-21" } : {}),
    },
    signal(),
  );
  if (!result.ok) throw result.error;
  return { actor, calendar: cal.value, activity: result.value };
}
const intents = (id: string) =>
  ctx.db.select().from(activityReminderIntents).where(eq(activityReminderIntents.activityId, id));

it("inherits personal calendar defaults and groups only equal fire times", async () => {
  const { actor, activity, calendar } = await fixture();
  await ctx.db.insert(calendarReminderDefaults).values({
    calendarId: calendar.id,
    userId: actor.id,
    rules: {
      timed: [
        { method: "notification", minutesBefore: 30 },
        { method: "email", minutesBefore: 60 },
      ],
      allDay: [],
    },
  });
  await ctx.db.transaction((tx) => reconcileReminderIntent(tx, activity, signal()));
  const live = (await intents(activity.id)).filter((r) => r.state !== "cancelled");
  expect(live.map((r) => [r.fireAt.toISOString(), r.inApp, r.email]).sort()).toEqual([
    ["2027-03-21T04:30:00.000Z", false, true],
    ["2027-03-21T05:00:00.000Z", true, false],
  ]);
  expect(live.every((r) => r.settingsId !== null)).toBe(true);
});
it("uses civil 09:00 all-day rules instead of the compatibility anchor", async () => {
  const { activity } = await fixture(true);
  const live = (await intents(activity.id)).filter((r) => r.state !== "cancelled");
  expect(live).toHaveLength(1);
  expect(live[0]?.fireAt.toISOString()).toBe("2027-03-21T05:30:00.000Z");
});
it("keeps a reader's explicit personal reminder independent from the assignee", async () => {
  const { actor, activity, calendar } = await fixture();
  const reader = await seedUser(ctx.db);
  await setCalendarMember(
    ctx.db,
    actor,
    { calendarId: calendar.id, userId: reader.id, role: "reader" },
    signal(),
  );
  await ctx.db.insert(activityReminderSettings).values({
    activityId: activity.id,
    userId: reader.id,
    source: "personal",
    useDefault: false,
    timeZone: "Asia/Tehran",
    rules: { timed: [{ method: "notification", minutesBefore: 60 }], allDay: [] },
  });
  await ctx.db.transaction((tx) => reconcileReminderIntent(tx, activity, signal()));
  expect(
    (await intents(activity.id)).some((r) => r.assigneeId === reader.id && r.state !== "cancelled"),
  ).toBe(true);
});
it("remembers explicit no-reminder rules and never recreates them on unrelated edits", async () => {
  const { actor, activity } = await fixture();
  await ctx.db
    .update(activityReminderSettings)
    .set({ source: "personal", useDefault: false, rules: { timed: [], allDay: [] }, version: 2 })
    .where(eq(activityReminderSettings.userId, actor.id));
  await ctx.db.transaction((tx) => reconcileReminderIntent(tx, activity, signal()));
  expect((await intents(activity.id)).filter((r) => r.state !== "cancelled")).toHaveLength(0);
});
it("marks direct CRM date/reassignment writes for durable reconciliation", async () => {
  const { activity } = await fixture();
  await ctx.db.delete(reminderRebuilds).where(eq(reminderRebuilds.activityId, activity.id));
  await ctx.db
    .update(activities)
    .set({ dueAt: new Date("2027-03-22T05:30:00.000Z") })
    .where(eq(activities.id, activity.id));
  expect(
    await ctx.db
      .select()
      .from(reminderRebuilds)
      .where(eq(reminderRebuilds.activityId, activity.id)),
  ).toHaveLength(1);
});
it("invalidates stale all-day jobs even when only canonical civil date changes", async () => {
  const { activity } = await fixture(true);
  const [intent] = await intents(activity.id);
  if (intent === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "intent absent");
  await ctx.db
    .update(activityReminderIntents)
    .set({ fireAt: new Date("2020-01-01T00:00Z") })
    .where(eq(activityReminderIntents.id, intent.id));
  await ctx.db
    .update(activities)
    .set({ dueDate: "2027-03-22" })
    .where(eq(activities.id, activity.id));
  await handleReminderJob(ctx.db, { data: { intentId: intent.id } }, signal(), null);
  expect(
    await ctx.db.select().from(notifications).where(eq(notifications.userId, activity.assigneeId)),
  ).toHaveLength(0);
});
it("does not commit an event when its own reminder revision is invalid", async () => {
  const { actor, activity } = await fixture();
  const before = await ctx.db.select({ id: activities.id }).from(activities);
  const result = await createActivity(
    ctx.db,
    actor,
    {
      typeId: activity.typeId,
      subject: "Must roll back",
      dueAt: "2027-03-21T05:30:00.000Z",
      personalReminders: {
        selection: { useDefault: false, ...DEFAULT_REMINDER_RULES },
        expectedRevision: 9,
      },
    },
    signal(),
  );
  expect(result.ok).toBe(false);
  expect(await ctx.db.select({ id: activities.id }).from(activities)).toHaveLength(before.length);
});
