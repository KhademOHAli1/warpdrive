import { and, eq, isNull } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { type Activity, activities, calendars, emailAccounts } from "@/db/schema";
import { resolveDelivery } from "@/features/notifications/preferences";
import { canSee } from "@/features/permissions/canSee";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { calendarActivityAccess } from "./calendarAccess";
import { calendarRole } from "./calendars";
import { resolveActivityVisibility } from "./visibility";

export type ReminderEmailCapability = "available" | "mailboxMissing" | "channelDisabled";
export function reminderSettingsNotFound() {
  return err(new AppError(ERROR_IDS.ACTIVITY_NOT_FOUND, "reminder context not found"));
}
export async function assertReminderActivityReadable(
  db: DbOrTx,
  actor: PermSetUser,
  row: Activity,
  signal: AbortSignal,
  lock = false,
): Promise<Result<void, AppError>> {
  signal.throwIfAborted();
  if (!actor.isActive || row.deletedAt !== null) return reminderSettingsNotFound();
  const access = await calendarActivityAccess(db, actor, row, signal, lock);
  if (access?.read === false) return reminderSettingsNotFound();
  const visibility = await resolveActivityVisibility(db, row, signal);
  return visibility === null || !canSee(actor, visibility)
    ? reminderSettingsNotFound()
    : ok(undefined);
}
export async function loadReminderActivity(
  db: DbOrTx,
  actor: PermSetUser,
  id: string,
  signal: AbortSignal,
  lock = false,
): Promise<Result<Activity, AppError>> {
  signal.throwIfAborted();
  const query = db
    .select()
    .from(activities)
    .where(and(eq(activities.id, id), isNull(activities.deletedAt)));
  const [row] = await (lock ? query.for("no key update") : query);
  signal.throwIfAborted();
  if (row === undefined) return reminderSettingsNotFound();
  const readable = await assertReminderActivityReadable(db, actor, row, signal, lock);
  return readable.ok ? ok(row) : readable;
}
export async function loadReminderCalendar(
  db: DbOrTx,
  actor: PermSetUser,
  id: string,
  signal: AbortSignal,
  lock = false,
) {
  const role = await calendarRole(db, actor, id, signal, lock);
  if (role === null || role === "freeBusy") return reminderSettingsNotFound();
  const [row] = await db
    .select()
    .from(calendars)
    .where(and(eq(calendars.id, id), isNull(calendars.deletedAt)));
  signal.throwIfAborted();
  return row === undefined ? reminderSettingsNotFound() : ok(row);
}
export async function lockReminderCalendarForDefaults(
  db: DbOrTx,
  actor: PermSetUser,
  id: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!actor.isActive) return reminderSettingsNotFound();
  // Lock before reading grants or defaults so initial reconciliation commits before fanout.
  const [row] = await db
    .select({ id: calendars.id })
    .from(calendars)
    .where(eq(calendars.id, id))
    .for("update");
  signal.throwIfAborted();
  return row === undefined
    ? reminderSettingsNotFound()
    : loadReminderCalendar(db, actor, id, signal);
}
export async function reminderEmailCapability(
  db: DbOrTx,
  userId: string,
  signal: AbortSignal,
): Promise<ReminderEmailCapability> {
  const delivery = await resolveDelivery(db, userId, "activity_reminder", signal);
  if (!delivery.email) return "channelDisabled";
  const [mailbox] = await db
    .select({ id: emailAccounts.id })
    .from(emailAccounts)
    .where(and(eq(emailAccounts.userId, userId), eq(emailAccounts.status, "connected")))
    .limit(1);
  signal.throwIfAborted();
  return mailbox === undefined ? "mailboxMissing" : "available";
}
