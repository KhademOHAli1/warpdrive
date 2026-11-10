import { assert, expect, it } from "vitest";
import { activityReminderIntents, activityTypes, notifications } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { canDeliverActivityReminder } from "@/features/notifications/calendarPrivacy";
import { getFeed, getUnreadCount } from "@/features/notifications/feed";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import { createCalendar, setCalendarArchived } from "./calendars";
import { setCalendarReminderDefaults } from "./personalReminderSettings";
import { processActivityReminder } from "./reminderDelivery";
import { createActivity } from "./repo";

it("keeps native in-app receipt history independent of calendar defaults and never authorizes email", async () => {
  const h = await makeTestDb();
  const signal = AbortSignal.timeout(10_000);
  try {
    const user = await seedUser(h.db, { isAdmin: true });
    const actor: PermSetUser = {
      id: user.id,
      type: "admin",
      isActive: true,
      flags: new Set(),
      groupIds: new Set(),
    };
    const calendar = await createCalendar(
      h.db,
      actor,
      { name: "Native calendar", timeZone: "UTC" },
      signal,
    );
    assert(calendar.ok);
    const [type] = await h.db.select().from(activityTypes).limit(1);
    assert(type !== undefined);
    const created = await createActivity(
      h.db,
      actor,
      {
        typeId: type.id,
        subject: "Native in-app receipt",
        calendarId: calendar.value.id,
        dueAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        durationMinutes: 60,
        authoredTimeZone: "UTC",
        reminderTimeZone: "UTC",
        reminder: { kind: "before_start", channel: "in_app", leadMinutes: 10 },
      },
      signal,
    );
    assert(created.ok);
    const [native] = await h.db.select().from(activityReminderIntents);
    assert(native !== undefined);
    await processActivityReminder(h.db, created.value.id, native.generationId, signal);
    const [notice] = await h.db.select().from(notifications);
    assert(notice !== undefined);
    expect.soft(await canDeliverActivityReminder(h.db, user.id, notice, signal)).toBe(false);
    expect(await getFeed(h.db, actor, 20, signal)).toHaveLength(1);
    const defaults = await setCalendarReminderDefaults(
      h.db,
      actor,
      {
        calendarId: calendar.value.id,
        expectedRevision: 0,
        defaults: { timed: [{ method: "notification", minutesBefore: 30 }], allDay: [] },
      },
      signal,
    );
    assert(defaults.ok);
    expect.soft(await getFeed(h.db, actor, 20, signal)).toHaveLength(1);
    expect.soft(await getUnreadCount(h.db, actor, signal)).toBe(1);
    expect(await canDeliverActivityReminder(h.db, user.id, notice, signal)).toBe(false);
    assert(
      (await setCalendarArchived(h.db, actor, { id: calendar.value.id, archived: true }, signal))
        .ok,
    );
    expect(await getFeed(h.db, actor, 20, signal)).toHaveLength(0);
  } finally {
    await h.close();
  }
});
