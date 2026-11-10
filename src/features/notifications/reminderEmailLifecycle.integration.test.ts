import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  activities,
  activityTypes,
  calendarMembers,
  calendars,
  emailAccounts,
  notifications,
} from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { ok } from "@/types/result";
import { runCalendarNotificationJob as runEmailNotificationJob } from "./calendarNotification.test-helpers";
import { getFeed, getUnreadCount } from "./feed";
import { setPreference } from "./preferences";

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0];
const signal = () => AbortSignal.timeout(10_000);
async function fixture(db: TestDb) {
  const owner = await seedUser(db);
  const recipient = await seedUser(db);
  const other = await seedUser(db);
  const [calendar] = await db
    .insert(calendars)
    .values({
      ownerId: owner.id,
      name: "Erinnerungen / یادآوری‌ها",
      timeZone: "Europe/Berlin",
    })
    .returning();
  const [type] = await db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (calendar === undefined || type === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "calendar fixture missing");
  await db
    .insert(calendarMembers)
    .values({ calendarId: calendar.id, userId: recipient.id, role: "reader" });
  const [activity] = await db
    .insert(activities)
    .values({
      typeId: type.id,
      ownerId: owner.id,
      assigneeId: recipient.id,
      subject: "Nur zum aktuellen Termin / فقط زمان فعلی",
      calendarId: calendar.id,
      dueAt: new Date("2030-03-21T09:00:00Z"),
    })
    .returning();
  if (activity === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "activity fixture missing");
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
  const [notification] = await db
    .insert(notifications)
    .values({
      userId: recipient.id,
      type: "activity_reminder",
      entityType: null,
      entityId: null,
      payload: {
        activityId: activity.id,
        subject: activity.subject,
        dueAt: activity.dueAt?.toISOString(),
      },
    })
    .returning();
  if (notification === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "notification fixture missing");
  return { activity, notification, recipient, other };
}

for (const change of [
  "rescheduled",
  "completed",
  "deleted",
  "missing",
  "reassigned",
  "undated",
  "current",
] as const) {
  it(`rechecks a ${change} activity before queued reminder email delivery`, async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      if (change === "missing") await db.delete(activities).where(eq(activities.id, f.activity.id));
      else if (change !== "current") {
        const updates = {
          rescheduled: { dueAt: new Date("2030-03-21T10:00:00Z") },
          completed: { done: true },
          deleted: { deletedAt: new Date() },
          reassigned: { assigneeId: f.other.id },
          undated: { dueAt: null },
        };
        await db.update(activities).set(updates[change]).where(eq(activities.id, f.activity.id));
      }
      let sends = 0;
      const result = await runEmailNotificationJob(
        db,
        { notificationId: f.notification.id },
        signal(),
        {
          send: () => {
            sends++;
            return Promise.resolve(ok({ gmailMessageId: "synthetic" }));
          },
        },
      );
      expect(result).toEqual(ok({ sent: change === "current" }));
      expect(sends).toBe(change === "current" ? 1 : 0);
    });
  });
}

for (const change of ["deleted", "missing"] as const) {
  it(`hides an activity notification when its event is ${change}`, async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      if (change === "missing") await db.delete(activities).where(eq(activities.id, f.activity.id));
      else
        await db
          .update(activities)
          .set({ deletedAt: new Date() })
          .where(eq(activities.id, f.activity.id));
      const actor = {
        id: f.recipient.id,
        type: "regular" as const,
        isActive: true,
        groupIds: new Set<string>(),
      };
      expect(await getFeed(db, actor, 20, signal())).toHaveLength(0);
      expect(await getUnreadCount(db, actor, signal())).toBe(0);
    });
  });
}
