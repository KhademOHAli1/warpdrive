import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { reconcileReminderIntent } from "./calendarReminderIntent";
import {
  loadReminderActivity,
  loadReminderCalendar,
  lockReminderCalendarForDefaults,
  reminderEmailCapability,
} from "./reminderSettingsAccess";
import { calendarReminderWriteSchema, eventReminderWriteSchema } from "./reminderSettingsSchemas";
import {
  type CalendarReminderContext,
  type EventReminderContext,
  eventReminderContext,
  reminderDefaultsForUser,
} from "./reminderSettingsState";
import {
  writeCalendarReminderDefaults,
  writePersonalReminderSelection,
} from "./reminderSettingsWrite";

export type { CalendarReminderContext, EventReminderContext } from "./reminderSettingsState";
export { writePersonalReminderSelection } from "./reminderSettingsWrite";

function invalidInput() {
  return err(
    new AppError(ERROR_IDS.ACTIVITY_UPDATE_INPUT_INVALID, "invalid personal reminder settings"),
  );
}
async function calendarContext(
  db: DbOrTx,
  actor: PermSetUser,
  calendarId: string,
  signal: AbortSignal,
): Promise<CalendarReminderContext> {
  return {
    ...(await reminderDefaultsForUser(db, actor.id, calendarId, signal)),
    emailCapability: await reminderEmailCapability(db, actor.id, signal),
  };
}
export async function getCalendarReminderDefaults(
  db: DbOrTx,
  actor: PermSetUser,
  calendarId: string,
  signal: AbortSignal,
): Promise<Result<CalendarReminderContext, AppError>> {
  const access = await loadReminderCalendar(db, actor, calendarId, signal);
  return access.ok ? ok(await calendarContext(db, actor, calendarId, signal)) : access;
}
export async function setCalendarReminderDefaults(
  db: Db,
  actor: PermSetUser,
  input: unknown,
  signal: AbortSignal,
): Promise<Result<CalendarReminderContext, AppError>> {
  const parsed = calendarReminderWriteSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  return db.transaction(async (tx) => {
    const access = await lockReminderCalendarForDefaults(tx, actor, parsed.data.calendarId, signal);
    if (!access.ok) return access;
    const saved = await writeCalendarReminderDefaults(tx, actor, parsed.data, signal);
    return saved.ok ? ok(await calendarContext(tx, actor, parsed.data.calendarId, signal)) : saved;
  });
}
export async function getEventReminderSettings(
  db: DbOrTx,
  actor: PermSetUser,
  activityId: string,
  signal: AbortSignal,
): Promise<Result<EventReminderContext, AppError>> {
  const loaded = await loadReminderActivity(db, actor, activityId, signal);
  return loaded.ok ? ok(await eventReminderContext(db, actor, loaded.value, signal)) : loaded;
}
export async function setEventReminderSettings(
  db: Db,
  actor: PermSetUser,
  input: unknown,
  signal: AbortSignal,
): Promise<Result<EventReminderContext, AppError>> {
  const parsed = eventReminderWriteSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  return db.transaction(async (tx) => {
    const loaded = await loadReminderActivity(tx, actor, parsed.data.activityId, signal, true);
    if (!loaded.ok) return loaded;
    const saved = await writePersonalReminderSelection(
      tx,
      actor,
      loaded.value,
      parsed.data,
      signal,
    );
    if (!saved.ok) return saved;
    await reconcileReminderIntent(tx, loaded.value, signal);
    return ok(await eventReminderContext(tx, actor, loaded.value, signal));
  });
}
