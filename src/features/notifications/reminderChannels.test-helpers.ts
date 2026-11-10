import { eq } from "drizzle-orm";
import { vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  activities,
  activityReminderSettings,
  activityTypes,
  calendarMembers,
  calendarReminderDefaults,
  calendarReminderIntents,
  calendars,
  emailAccounts,
} from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { reminderTemporalSignature } from "@/features/activities/reminderPolicy";
import { ok } from "@/types/result";
import { setPreference } from "./preferences";
import { createNotification } from "./produce";

export const signal = () => AbortSignal.timeout(10_000);
export const required = <T>(row: T | undefined): T => {
  if (row === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "reminder fixture absent");
  return row;
};
export async function reminderChannelFixture(
  db: Db,
  options: { inApp?: boolean; email?: boolean; personal?: boolean; defaults?: boolean } = {},
) {
  const owner = await seedUser(db);
  const recipient = await seedUser(db);
  const other = await seedUser(db);
  const calendar = required(
    (
      await db
        .insert(calendars)
        .values({ ownerId: owner.id, name: "Channels", timeZone: "Europe/Berlin" })
        .returning()
    )[0],
  );
  await db
    .insert(calendarMembers)
    .values({ calendarId: calendar.id, userId: recipient.id, role: "reader" });
  const type = required(
    (await db.select().from(activityTypes).where(eq(activityTypes.key, "meeting")))[0],
  );
  const activity = required(
    (
      await db
        .insert(activities)
        .values({
          typeId: type.id,
          ownerId: owner.id,
          assigneeId: options.personal === true ? owner.id : recipient.id,
          subject: "Personal channels",
          calendarId: calendar.id,
          dueAt: new Date("2030-03-21T09:00Z"),
          allDay: true,
          dueDate: "2030-03-21",
          eventTimeZone: "Europe/Berlin",
        })
        .returning()
    )[0],
  );
  const settings = required(
    (
      await db
        .insert(activityReminderSettings)
        .values({
          activityId: activity.id,
          userId: recipient.id,
          source: options.personal === true ? "personal" : "assignment",
          useDefault: options.defaults ?? false,
          timeZone: "Europe/Berlin",
        })
        .returning()
    )[0],
  );
  if (options.defaults === true)
    await db
      .insert(calendarReminderDefaults)
      .values({ calendarId: calendar.id, userId: recipient.id });
  const intent = required(
    (
      await db
        .insert(calendarReminderIntents)
        .values({
          activityId: activity.id,
          assigneeId: recipient.id,
          settingsId: settings.id,
          settingsVersion: settings.version,
          defaultsVersion: options.defaults === true ? 1 : 0,
          eventSignature: reminderTemporalSignature(activity),
          dueAt: required(activity.dueAt ?? undefined),
          fireAt: new Date("2020-01-01T00:00Z"),
          inApp: options.inApp ?? true,
          email: options.email ?? true,
        })
        .returning()
    )[0],
  );
  const produced = await createNotification(
    db,
    {
      recipientId: recipient.id,
      type: "activity_reminder",
      actorId: null,
      entityType: null,
      entityId: null,
      payload: {
        activityId: activity.id,
        reminderIntentId: intent.id,
        subject: activity.subject,
        dueAt: activity.dueAt?.toISOString(),
      },
    },
    signal(),
  );
  if (!produced.ok || !("notificationId" in produced.value))
    throw new AppError(ERROR_IDS.DB_INVARIANT, "internal receipt suppressed");
  const notificationId = produced.value.notificationId;
  await db
    .update(calendarReminderIntents)
    .set({ state: "delivered", deliveredAt: new Date(), notificationId })
    .where(eq(calendarReminderIntents.id, intent.id));
  await db
    .insert(emailAccounts)
    .values({ userId: recipient.id, emailAddress: recipient.email, status: "connected" });
  await setPreference(
    db,
    recipient.id,
    "activity_reminder",
    { inApp: true, email: true },
    signal(),
  );
  const actor = {
    id: recipient.id,
    type: "regular" as const,
    isActive: true,
    groupIds: new Set<string>(),
  };
  const send = vi.fn().mockResolvedValue(ok({ gmailMessageId: "synthetic" }));
  return {
    owner,
    recipient,
    other,
    calendar,
    activity,
    settings,
    intent,
    notificationId,
    actor,
    send,
  };
}
