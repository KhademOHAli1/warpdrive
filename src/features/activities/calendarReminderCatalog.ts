import { and, eq, inArray } from "drizzle-orm";
import { calendarReminderDefaults } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { listCalendars } from "./calendars";
import { DEFAULT_REMINDER_RULES } from "./reminderPolicy";
import { reminderEmailCapability } from "./reminderSettingsAccess";
import { type CalendarReminderContext, storedReminderRules } from "./reminderSettingsState";

type CatalogCalendar = Awaited<ReturnType<typeof listCalendars>>[number];
export type PersonalReminderCalendar = CatalogCalendar & {
  personalReminders?: CalendarReminderContext;
};

// The authoritative calendar list has already resolved membership for this actor. Load only
// their settings in one batch, since another calendar owner's defaults are never inherited.
export async function calendarReminderCatalog(
  db: DbOrTx,
  actor: PermSetUser,
  calendars: CatalogCalendar[],
  signal: AbortSignal,
): Promise<PersonalReminderCalendar[]> {
  signal.throwIfAborted();
  const readable = actor.isActive
    ? calendars.filter(
        (calendar) =>
          calendar.deletedAt === null &&
          (calendar.role === "owner" || calendar.role === "editor" || calendar.role === "reader"),
      )
    : [];
  if (readable.length === 0) return calendars;
  const ids = readable.map((calendar) => calendar.id);
  const [stored, emailCapability] = await Promise.all([
    db
      .select()
      .from(calendarReminderDefaults)
      .where(
        and(
          eq(calendarReminderDefaults.userId, actor.id),
          inArray(calendarReminderDefaults.calendarId, ids),
        ),
      ),
    reminderEmailCapability(db, actor.id, signal),
  ]);
  signal.throwIfAborted();
  const byCalendar = new Map(stored.map((row) => [row.calendarId, row]));
  const eligible = new Set(ids);
  return calendars.map((calendar) => {
    if (!eligible.has(calendar.id)) return calendar;
    const settings = byCalendar.get(calendar.id);
    return {
      ...calendar,
      personalReminders: {
        defaults:
          settings === undefined ? DEFAULT_REMINDER_RULES : storedReminderRules(settings.rules),
        revision: settings?.version ?? 0,
        emailCapability,
      },
    };
  });
}
