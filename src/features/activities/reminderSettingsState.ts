import { and, eq } from "drizzle-orm";
import {
  type Activity,
  activityReminderSettings,
  calendarReminderDefaults,
  calendars,
} from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { activityAccountPreferences } from "./accountTimeZone";
import {
  DEFAULT_REMINDER_RULES,
  type ReminderDefaults,
  type ReminderSelection,
  reminderDefaultsSchema,
} from "./reminderPolicy";
import { type ReminderEmailCapability, reminderEmailCapability } from "./reminderSettingsAccess";

export interface CalendarReminderContext {
  defaults: ReminderDefaults;
  revision: number;
  emailCapability: ReminderEmailCapability;
}
export interface EventReminderContext {
  selection: ReminderSelection;
  defaults: ReminderDefaults;
  revision: number;
  subscribed: boolean;
  emailCapability: ReminderEmailCapability;
  timeZone: string;
}
export function storedReminderRules(value: unknown): ReminderDefaults {
  const parsed = reminderDefaultsSchema.safeParse(value);
  return parsed.success ? parsed.data : { timed: [], allDay: [] };
}
export async function reminderDefaultsForUser(
  db: DbOrTx,
  userId: string,
  calendarId: string | null,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const [row] =
    calendarId === null
      ? []
      : await db
          .select()
          .from(calendarReminderDefaults)
          .where(
            and(
              eq(calendarReminderDefaults.calendarId, calendarId),
              eq(calendarReminderDefaults.userId, userId),
            ),
          );
  signal.throwIfAborted();
  return {
    defaults: row === undefined ? DEFAULT_REMINDER_RULES : storedReminderRules(row.rules),
    revision: row?.version ?? 0,
  };
}
export async function reminderSettingsTimeZone(
  db: DbOrTx,
  actor: PermSetUser,
  row: Activity,
  existingTimeZone: string | undefined,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (row.eventTimeZone !== null) return row.eventTimeZone;
  if (existingTimeZone !== undefined) return existingTimeZone;
  if (row.calendarId !== null) {
    const [calendar] = await db
      .select({ timeZone: calendars.timeZone })
      .from(calendars)
      .where(eq(calendars.id, row.calendarId));
    signal.throwIfAborted();
    if (calendar !== undefined) return calendar.timeZone;
  }
  const preferences = await activityAccountPreferences(db, actor.id);
  signal.throwIfAborted();
  return preferences.timeZone;
}
export async function eventReminderContext(
  db: DbOrTx,
  actor: PermSetUser,
  row: Activity,
  signal: AbortSignal,
): Promise<EventReminderContext> {
  const [settings] = await db
    .select()
    .from(activityReminderSettings)
    .where(
      and(
        eq(activityReminderSettings.activityId, row.id),
        eq(activityReminderSettings.userId, actor.id),
      ),
    );
  signal.throwIfAborted();
  const automatic = row.assigneeId === actor.id && row.reminderAutomationEnabled;
  const applicable = settings?.source === "assignment" && !automatic ? undefined : settings;
  const selection: ReminderSelection =
    applicable === undefined
      ? automatic
        ? { useDefault: true }
        : { useDefault: false, timed: [], allDay: [] }
      : applicable.useDefault
        ? { useDefault: true }
        : { useDefault: false, ...storedReminderRules(applicable.rules) };
  const { defaults } = await reminderDefaultsForUser(db, actor.id, row.calendarId, signal);
  const effective = selection.useDefault ? defaults : selection;
  const timeZone = await reminderSettingsTimeZone(db, actor, row, settings?.timeZone, signal);
  return {
    selection,
    defaults,
    revision: settings?.version ?? 0,
    subscribed: (row.allDay ? effective.allDay : effective.timed).length > 0,
    emailCapability: await reminderEmailCapability(db, actor.id, signal),
    timeZone,
  };
}
