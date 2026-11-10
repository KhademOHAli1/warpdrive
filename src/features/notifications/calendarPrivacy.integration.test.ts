import { and, eq } from "drizzle-orm";
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
import type { AuthUser } from "@/features/permissions/types";
import { ok } from "@/types/result";
import { runCalendarNotificationJob as runEmailNotificationJob } from "./calendarNotification.test-helpers";
import { getFeed, getUnreadCount } from "./feed";
import { setPreference } from "./preferences";
import { createNotification } from "./produce";

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0];
const signal = () => AbortSignal.timeout(10_000);
const actor = (id: string): AuthUser => ({
  id,
  type: "regular",
  isActive: true,
  groupIds: new Set(),
});

async function fixture(db: TestDb) {
  const owner = await seedUser(db);
  const recipient = await seedUser(db);
  const [calendar] = await db
    .insert(calendars)
    .values({
      ownerId: owner.id,
      name: "تقویم خصوصی / Privat",
      timeZone: "Asia/Tehran",
    })
    .returning();
  const [type] = await db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (calendar === undefined || type === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "calendar fixture missing");
  const [activity] = await db
    .insert(activities)
    .values({
      typeId: type.id,
      ownerId: owner.id,
      assigneeId: recipient.id,
      subject: "موضوع محرمانه / Vertraulich",
      calendarId: calendar.id,
      dueAt: new Date("2030-03-21T09:00:00Z"),
    })
    .returning();
  if (activity === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "activity fixture missing");
  return { owner, recipient, calendar, activity };
}

for (const state of ["unshared", "freeBusy", "private", "archived"] as const) {
  it(`suppresses calendar activity production for an assignee with ${state} access`, async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      if (state === "freeBusy" || state === "private")
        await db.insert(calendarMembers).values({
          calendarId: f.calendar.id,
          userId: f.recipient.id,
          role: state === "freeBusy" ? "freeBusy" : "reader",
        });
      if (state === "private")
        await db
          .update(activities)
          .set({ eventVisibility: "private" })
          .where(eq(activities.id, f.activity.id));
      if (state === "archived")
        await db
          .update(calendars)
          .set({ deletedAt: new Date() })
          .where(eq(calendars.id, f.calendar.id));
      const result = await createNotification(
        db,
        {
          recipientId: f.recipient.id,
          type: "activity_assigned",
          actorId: f.owner.id,
          entityType: null,
          entityId: null,
          payload: { activityId: f.activity.id, subject: f.activity.subject },
        },
        signal(),
      );
      expect(result).toEqual(ok({ suppressed: true }));
      expect(await db.select().from(notifications)).toHaveLength(0);
    });
  });
}

it("rechecks calendar access after revocation for feed and unread count", async () => {
  await withTestDb(async (db) => {
    const f = await fixture(db);
    await db
      .insert(calendarMembers)
      .values({ calendarId: f.calendar.id, userId: f.recipient.id, role: "reader" });
    const result = await createNotification(
      db,
      {
        recipientId: f.recipient.id,
        type: "activity_reminder",
        actorId: null,
        entityType: null,
        entityId: null,
        payload: { activityId: f.activity.id, subject: f.activity.subject },
      },
      signal(),
    );
    if (!result.ok || !("notificationId" in result.value))
      throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "allowed reminder suppressed");
    const recipient = actor(f.recipient.id);
    expect(await getFeed(db, recipient, 20, signal())).toHaveLength(1);
    expect(await getUnreadCount(db, recipient, signal())).toBe(1);
    await setPreference(
      db,
      recipient.id,
      "activity_reminder",
      { inApp: true, email: true },
      signal(),
    );
    await db
      .delete(calendarMembers)
      .where(
        and(
          eq(calendarMembers.calendarId, f.calendar.id),
          eq(calendarMembers.userId, recipient.id),
        ),
      );
    expect(await getFeed(db, recipient, 20, signal())).toHaveLength(0);
    expect(await getUnreadCount(db, recipient, signal())).toBe(0);
  });
});

it("drops a queued email after calendar membership revocation", async () => {
  await withTestDb(async (db) => {
    const f = await fixture(db);
    await db
      .insert(calendarMembers)
      .values({ calendarId: f.calendar.id, userId: f.recipient.id, role: "reader" });
    await db
      .insert(emailAccounts)
      .values({ userId: f.recipient.id, emailAddress: f.recipient.email, status: "connected" });
    await setPreference(
      db,
      f.recipient.id,
      "activity_reminder",
      { inApp: true, email: true },
      signal(),
    );
    const [notification] = await db
      .insert(notifications)
      .values({
        userId: f.recipient.id,
        type: "activity_reminder",
        entityType: null,
        entityId: null,
        payload: { activityId: f.activity.id, subject: f.activity.subject },
      })
      .returning();
    if (notification === undefined)
      throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "notification fixture missing");
    await db
      .delete(calendarMembers)
      .where(
        and(
          eq(calendarMembers.calendarId, f.calendar.id),
          eq(calendarMembers.userId, f.recipient.id),
        ),
      );
    let sends = 0;
    const delivered = await runEmailNotificationJob(
      db,
      { notificationId: notification.id },
      signal(),
      {
        send: () => {
          sends++;
          return Promise.resolve(ok({ gmailMessageId: "synthetic" }));
        },
      },
    );
    expect(delivered).toEqual(ok({ sent: false }));
    expect(sends).toBe(0);
  });
});

it("retains legacy activity and ungated system notifications", async () => {
  await withTestDb(async (db) => {
    const f = await fixture(db);
    await db.update(activities).set({ calendarId: null }).where(eq(activities.id, f.activity.id));
    for (const payload of [{ activityId: f.activity.id, subject: "Legacy" }, { note: "system" }]) {
      const result = await createNotification(
        db,
        {
          recipientId: f.recipient.id,
          type: "activity_reminder",
          actorId: null,
          entityType: null,
          entityId: null,
          payload,
        },
        signal(),
      );
      expect(result.ok && "notificationId" in result.value).toBe(true);
    }
    expect(await getFeed(db, actor(f.recipient.id), 20, signal())).toHaveLength(2);
    expect(await getUnreadCount(db, actor(f.recipient.id), signal())).toBe(2);
  });
});
