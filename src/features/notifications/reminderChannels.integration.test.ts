import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  activities,
  calendarReminderIntents,
  activityReminderSettings,
  calendarMembers,
  calendarReminderDefaults,
  calendars,
  notifications,
} from "@/db/schema";
import { admitReminderIntent } from "@/features/activities/reminderAdmission";
import { deliverReminderIntent } from "@/features/activities/reminderDelivery";
import { makeTestDb } from "@/test/db";
import { ok } from "@/types/result";
import { runEmailNotificationJob } from "./email/job";
import { getFeed, getUnreadCount } from "./feed";
import { setPreference } from "./preferences";
import { reminderChannelFixture, required, signal } from "./reminderChannels.test-helpers";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  ctx = await makeTestDb();
});
afterEach(async () => {
  await ctx.close();
});

const fixture = (options?: Parameters<typeof reminderChannelFixture>[1]) =>
  reminderChannelFixture(ctx.db, options);

it.each([
  { inApp: true, email: false },
  { inApp: false, email: true },
])("enforces the selected reminder channels: %j", async (channels) => {
  const f = await fixture(channels);
  expect(await ctx.db.select().from(notifications)).toHaveLength(1);
  expect(await getFeed(ctx.db, f.actor, 20, signal())).toHaveLength(channels.inApp ? 1 : 0);
  expect(await getUnreadCount(ctx.db, f.actor, signal())).toBe(channels.inApp ? 1 : 0);
  expect(
    await runEmailNotificationJob(ctx.db, { notificationId: f.notificationId }, signal(), {
      send: f.send,
    }),
  ).toEqual(ok({ sent: channels.email }));
  expect(f.send).toHaveBeenCalledTimes(channels.email ? 1 : 0);
});

it("allows an explicit reader's personal reminder without current assignment and ignores other users' policies", async () => {
  const f = await fixture({ personal: true });
  await ctx.db.insert(activityReminderSettings).values({
    activityId: f.activity.id,
    userId: f.other.id,
    source: "personal",
    version: 99,
    timeZone: "UTC",
  });
  await ctx.db
    .insert(calendarReminderDefaults)
    .values({ calendarId: f.calendar.id, userId: f.other.id, version: 88 });
  await ctx.db
    .insert(calendarReminderDefaults)
    .values({ calendarId: f.calendar.id, userId: f.recipient.id, version: 77 });
  const intent = required(
    (
      await ctx.db
        .select()
        .from(calendarReminderIntents)
        .where(eq(calendarReminderIntents.id, f.intent.id))
    )[0],
  );
  expect(await admitReminderIntent(ctx.db, f.activity, intent, signal())).toBe(true);
  expect(await getFeed(ctx.db, f.actor, 20, signal())).toHaveLength(1);
  expect(
    await runEmailNotificationJob(ctx.db, { notificationId: f.notificationId }, signal(), {
      send: f.send,
    }),
  ).toEqual(ok({ sent: true }));
});

it("delivers a personal reader's email-only intent into an internal receipt without an inbox item", async () => {
  const f = await fixture({ personal: true, inApp: false, email: true });
  await ctx.db.delete(notifications).where(eq(notifications.id, f.notificationId));
  await ctx.db
    .update(calendarReminderIntents)
    .set({ state: "pending", deliveredAt: null })
    .where(eq(calendarReminderIntents.id, f.intent.id));
  await deliverReminderIntent(ctx.db, { intentId: f.intent.id }, signal(), null);
  const receipt = required((await ctx.db.select().from(notifications))[0]);
  expect(receipt.payload.reminderIntentId).toBe(f.intent.id);
  expect((await ctx.db.select().from(calendarReminderIntents))[0]).toMatchObject({
    state: "delivered",
    notificationId: receipt.id,
  });
  expect(await getFeed(ctx.db, f.actor, 20, signal())).toHaveLength(0);
  expect(await getUnreadCount(ctx.db, f.actor, signal())).toBe(0);
  expect(
    await runEmailNotificationJob(ctx.db, { notificationId: receipt.id }, signal(), {
      send: f.send,
    }),
  ).toEqual(ok({ sent: true }));
  expect(f.send).toHaveBeenCalledTimes(1);
});

for (const change of [
  "revoked",
  "private",
  "archived",
  "cancelled",
  "settingsVersion",
  "defaultsVersion",
  "civilDate",
  "reassigned",
  "automationDisabled",
  "done",
  "deleted",
  "forgedReceipt",
  "malformedReceipt",
  "missingReceipt",
  "otherRecipient",
  "pending",
  "corruptSettings",
  "corruptDefaults",
] as const) {
  it(`denies a stale or forged ${change} reminder receipt in both channels`, async () => {
    const f = await fixture({ defaults: change !== "corruptSettings" });
    if (change === "revoked")
      await ctx.db
        .delete(calendarMembers)
        .where(
          and(
            eq(calendarMembers.calendarId, f.calendar.id),
            eq(calendarMembers.userId, f.recipient.id),
          ),
        );
    if (change === "private")
      await ctx.db
        .update(activities)
        .set({ eventVisibility: "private" })
        .where(eq(activities.id, f.activity.id));
    if (change === "archived")
      await ctx.db
        .update(calendars)
        .set({ deletedAt: new Date() })
        .where(eq(calendars.id, f.calendar.id));
    if (change === "cancelled" || change === "pending")
      await ctx.db
        .update(calendarReminderIntents)
        .set({ state: change })
        .where(eq(calendarReminderIntents.id, f.intent.id));
    if (change === "settingsVersion")
      await ctx.db
        .update(activityReminderSettings)
        .set({ version: 2 })
        .where(eq(activityReminderSettings.id, f.settings.id));
    if (change === "defaultsVersion")
      await ctx.db
        .update(calendarReminderDefaults)
        .set({ version: 2 })
        .where(eq(calendarReminderDefaults.userId, f.recipient.id));
    if (change === "civilDate")
      await ctx.db
        .update(activities)
        .set({ dueDate: "2030-03-22" })
        .where(eq(activities.id, f.activity.id));
    if (change === "reassigned")
      await ctx.db
        .update(activities)
        .set({ assigneeId: f.other.id })
        .where(eq(activities.id, f.activity.id));
    if (change === "automationDisabled")
      await ctx.db
        .update(activities)
        .set({ reminderAutomationEnabled: false })
        .where(eq(activities.id, f.activity.id));
    if (change === "done")
      await ctx.db.update(activities).set({ done: true }).where(eq(activities.id, f.activity.id));
    if (change === "deleted")
      await ctx.db
        .update(activities)
        .set({ deletedAt: new Date() })
        .where(eq(activities.id, f.activity.id));
    if (change === "forgedReceipt")
      await ctx.db
        .update(calendarReminderIntents)
        .set({ notificationId: null })
        .where(eq(calendarReminderIntents.id, f.intent.id));
    if (change === "otherRecipient")
      await ctx.db
        .update(calendarReminderIntents)
        .set({ assigneeId: f.other.id })
        .where(eq(calendarReminderIntents.id, f.intent.id));
    await changeReceipt(change, f);
    expect(await getFeed(ctx.db, f.actor, 20, signal())).toHaveLength(0);
    expect(await getUnreadCount(ctx.db, f.actor, signal())).toBe(0);
    expect(
      await runEmailNotificationJob(ctx.db, { notificationId: f.notificationId }, signal(), {
        send: f.send,
      }),
    ).toEqual(ok({ sent: false }));
    expect(f.send).not.toHaveBeenCalled();
  });
}

async function changeReceipt(change: string, f: Awaited<ReturnType<typeof fixture>>) {
  if (change === "corruptSettings")
    await ctx.db
      .update(activityReminderSettings)
      .set({ rules: sql`'{"timed":"broken"}'::jsonb` })
      .where(eq(activityReminderSettings.id, f.settings.id));
  if (change === "corruptDefaults")
    await ctx.db
      .update(calendarReminderDefaults)
      .set({ rules: sql`'{"allDay":null}'::jsonb` })
      .where(eq(calendarReminderDefaults.userId, f.recipient.id));
  if (change !== "missingReceipt" && change !== "malformedReceipt") return;
  await ctx.db
    .update(notifications)
    .set({
      payload: {
        activityId: f.activity.id,
        dueAt: f.activity.dueAt?.toISOString(),
        reminderIntentId: change === "missingReceipt" ? randomUUID() : "bad-id",
      },
    })
    .where(eq(notifications.id, f.notificationId));
}

it("keeps global notification preferences authoritative over per-event channels", async () => {
  const f = await fixture();
  await setPreference(
    ctx.db,
    f.recipient.id,
    "activity_reminder",
    { inApp: false, email: false },
    signal(),
  );
  expect(await getFeed(ctx.db, f.actor, 20, signal())).toHaveLength(0);
  expect(await getUnreadCount(ctx.db, f.actor, signal())).toBe(0);
  expect(
    await runEmailNotificationJob(ctx.db, { notificationId: f.notificationId }, signal(), {
      send: f.send,
    }),
  ).toEqual(ok({ sent: false }));
});
