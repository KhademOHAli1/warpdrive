import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  activities,
  calendarReminderIntents,
  activityReminderSettings,
  calendarReminderDefaults,
  notifications,
} from "@/db/schema";
import { makeTestDb } from "@/test/db";
import { ok } from "@/types/result";
import { runEmailNotificationJob } from "./email/job";
import { getFeed, getUnreadCount } from "./feed";
import { reminderChannelFixture, signal } from "./reminderChannels.test-helpers";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  ctx = await makeTestDb();
});
afterEach(async () => {
  await ctx.close();
});
async function fixture(options: Parameters<typeof reminderChannelFixture>[1] = {}) {
  const f = await reminderChannelFixture(ctx.db, options);
  await ctx.db
    .update(notifications)
    .set({
      payload: {
        activityId: f.activity.id,
        dueAt: f.activity.dueAt?.toISOString(),
        subject: f.activity.subject,
      },
    })
    .where(eq(notifications.id, f.notificationId));
  return f;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function channels(f: Fixture, inApp: boolean, email: boolean) {
  expect(await getFeed(ctx.db, f.actor, 20, signal())).toHaveLength(inApp ? 1 : 0);
  expect(await getUnreadCount(ctx.db, f.actor, signal())).toBe(inApp ? 1 : 0);
  expect(
    await runEmailNotificationJob(ctx.db, { notificationId: f.notificationId }, signal(), {
      send: f.send,
    }),
  ).toEqual(ok({ sent: email }));
  expect(f.send).toHaveBeenCalledTimes(email ? 1 : 0);
}

it("resolves a no-ID delivered receipt by its notification backlink and respects email-off", async () => {
  const f = await fixture({ email: false, inApp: true });
  await channels(f, true, false);
});
it("resolves a no-ID personal reader receipt without requiring assignment", async () => {
  const f = await fixture({ personal: true });
  await channels(f, true, true);
});
it.each([
  "cancelled",
  "ambiguous",
  "recipientMismatch",
  "dueMismatch",
  "activityMismatch",
  "malformedActivity",
] as const)("a %s no-ID backlink fails closed without legacy fallback", async (change) => {
  const f = await fixture();
  if (change === "cancelled")
    await ctx.db
      .update(calendarReminderIntents)
      .set({ state: "cancelled" })
      .where(eq(calendarReminderIntents.id, f.intent.id));
  if (change === "ambiguous")
    await ctx.db.insert(calendarReminderIntents).values({
      activityId: f.activity.id,
      assigneeId: f.recipient.id,
      dueAt: f.intent.dueAt,
      fireAt: f.intent.fireAt,
      state: "delivered",
      notificationId: f.notificationId,
    });
  if (change === "recipientMismatch")
    await ctx.db
      .update(calendarReminderIntents)
      .set({ assigneeId: f.other.id })
      .where(eq(calendarReminderIntents.id, f.intent.id));
  if (change === "dueMismatch" || change === "activityMismatch" || change === "malformedActivity")
    await ctx.db
      .update(notifications)
      .set({
        payload: {
          activityId:
            change === "activityMismatch"
              ? randomUUID()
              : change === "malformedActivity"
                ? "malformed"
                : f.activity.id,
          dueAt:
            change === "dueMismatch" ? "2030-03-22T09:00:00.000Z" : f.activity.dueAt?.toISOString(),
        },
      })
      .where(eq(notifications.id, f.notificationId));
  await channels(f, false, false);
});

for (const linked of [true, false]) {
  it.each(["none", "notificationOnly", "calendarDefault", "malformed"] as const)(
    `${linked ? "legacy intent" : "unlinked notice"} cannot bypass own %s policy before rebuild`,
    async (policy) => {
      const f = await fixture();
      if (linked)
        await ctx.db
          .update(calendarReminderIntents)
          .set({ settingsId: null, settingsVersion: 0 })
          .where(eq(calendarReminderIntents.id, f.intent.id));
      else
        await ctx.db
          .delete(calendarReminderIntents)
          .where(eq(calendarReminderIntents.id, f.intent.id));
      if (policy === "calendarDefault") {
        await ctx.db
          .delete(activityReminderSettings)
          .where(eq(activityReminderSettings.id, f.settings.id));
        await ctx.db.insert(calendarReminderDefaults).values({
          calendarId: f.calendar.id,
          userId: f.recipient.id,
          rules: {
            timed: [{ method: "notification", minutesBefore: 30 }],
            allDay: [{ method: "notification", daysBefore: 0, time: "09:00" }],
          },
        });
      } else {
        await ctx.db
          .update(activityReminderSettings)
          .set({
            source: "personal",
            useDefault: false,
            rules:
              policy === "none"
                ? { timed: [], allDay: [] }
                : {
                    timed: [{ method: "notification", minutesBefore: 30 }],
                    allDay: [{ method: "notification", daysBefore: 0, time: "09:00" }],
                  },
          })
          .where(eq(activityReminderSettings.id, f.settings.id));
        if (policy === "malformed")
          await ctx.db
            .update(activityReminderSettings)
            .set({ rules: sql`'{"timed":null}'::jsonb` })
            .where(eq(activityReminderSettings.id, f.settings.id));
      }
      await channels(f, false, false);
    },
  );
}

it("retains an eligible unlinked legacy notice without an own policy, ignoring other users' choices", async () => {
  const f = await fixture();
  await ctx.db
    .update(activities)
    .set({ allDay: false, dueDate: null })
    .where(eq(activities.id, f.activity.id));
  await ctx.db.delete(calendarReminderIntents).where(eq(calendarReminderIntents.id, f.intent.id));
  await ctx.db
    .delete(activityReminderSettings)
    .where(eq(activityReminderSettings.id, f.settings.id));
  await ctx.db.insert(activityReminderSettings).values({
    activityId: f.activity.id,
    userId: f.other.id,
    source: "personal",
    useDefault: false,
    timeZone: "UTC",
    rules: { timed: [], allDay: [] },
  });
  await ctx.db
    .insert(calendarReminderDefaults)
    .values({ calendarId: f.calendar.id, userId: f.other.id, rules: { timed: [], allDay: [] } });
  await channels(f, true, true);
});

it("a provided null activity reference cannot inherit a valid entity reference", async () => {
  const f = await fixture();
  await ctx.db
    .update(notifications)
    .set({
      entityType: "activity",
      entityId: f.activity.id,
      payload: { activityId: null, dueAt: f.activity.dueAt?.toISOString() },
    })
    .where(eq(notifications.id, f.notificationId));
  await channels(f, false, false);
});
it("a legacy all-day intent with no canonical signature cannot authorize a changed civil date", async () => {
  const f = await fixture();
  await ctx.db
    .update(calendarReminderIntents)
    .set({ settingsId: null, settingsVersion: 0, eventSignature: "" })
    .where(eq(calendarReminderIntents.id, f.intent.id));
  await ctx.db
    .update(activityReminderSettings)
    .set({ source: "assignment", useDefault: true, version: 0 })
    .where(eq(activityReminderSettings.id, f.settings.id));
  await ctx.db
    .update(activities)
    .set({ dueDate: "2030-03-22" })
    .where(eq(activities.id, f.activity.id));
  await channels(f, false, false);
});
it("keeps unlinked all-day inbox history but refuses email when its original civil date is unprovable", async () => {
  const f = await fixture();
  await ctx.db.delete(calendarReminderIntents).where(eq(calendarReminderIntents.id, f.intent.id));
  await ctx.db
    .delete(activityReminderSettings)
    .where(eq(activityReminderSettings.id, f.settings.id));
  await ctx.db
    .update(activities)
    .set({ dueDate: "2030-03-22" })
    .where(eq(activities.id, f.activity.id));
  await channels(f, true, false);
});
it("retains a legacy intent only with the untouched implicit assignment policy", async () => {
  const f = await fixture();
  await ctx.db
    .update(calendarReminderIntents)
    .set({ settingsId: null, settingsVersion: 0 })
    .where(eq(calendarReminderIntents.id, f.intent.id));
  await ctx.db
    .update(activityReminderSettings)
    .set({ source: "assignment", useDefault: true, version: 0 })
    .where(eq(activityReminderSettings.id, f.settings.id));
  await channels(f, true, true);
});
