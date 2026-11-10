import { and, eq, isNull, or } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { calendarMembers, calendars, users } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { type CalendarRole, calendarInput, calendarMemberInput } from "./calendarSchemas";

type Calendar = typeof calendars.$inferSelect;
export async function assertCalendarWritable(
  db: DbOrTx,
  actor: PermSetUser,
  id: string | null,
  signal: AbortSignal,
): Promise<Result<undefined, AppError>> {
  if (id === null) return ok(undefined);
  const role = await calendarRole(db, actor, id, signal, true);
  return role === "owner" || role === "editor"
    ? ok(undefined)
    : err(new AppError(ERROR_IDS.CALENDAR_NOT_FOUND, "calendar not found"));
}
export async function calendarRole(
  db: DbOrTx,
  actor: PermSetUser,
  id: string,
  signal: AbortSignal,
  lock = false,
): Promise<CalendarRole | null> {
  signal.throwIfAborted();
  if (!actor.isActive) return null;
  if (lock) {
    // Read membership in a new statement after the lock wait, since a revoke may have committed.
    const [calendar] = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(and(eq(calendars.id, id), isNull(calendars.deletedAt)))
      .for("share");
    signal.throwIfAborted();
    if (calendar === undefined) return null;
  }
  const [row] = await db
    .select({ ownerId: calendars.ownerId, role: calendarMembers.role, source: calendars.source })
    .from(calendars)
    .leftJoin(
      calendarMembers,
      and(eq(calendarMembers.calendarId, calendars.id), eq(calendarMembers.userId, actor.id)),
    )
    .where(and(eq(calendars.id, id), isNull(calendars.deletedAt)));
  signal.throwIfAborted();
  // Provider projection/outbound adapters own their authority. A local owner or
  // admin must never gain native write authority merely by owning the container.
  if (row === undefined || row.source !== "native") return null;
  return row.ownerId === actor.id || actor.type === "admin" ? "owner" : row.role;
}
export async function listCalendars(
  db: Db,
  actor: PermSetUser,
  signal: AbortSignal,
  includeArchived = false,
) {
  signal.throwIfAborted();
  if (!actor.isActive) return [];
  const rows = await db
    .select({ calendar: calendars, memberRole: calendarMembers.role })
    .from(calendars)
    .leftJoin(
      calendarMembers,
      and(eq(calendarMembers.calendarId, calendars.id), eq(calendarMembers.userId, actor.id)),
    )
    .where(
      and(
        eq(calendars.source, "native"),
        includeArchived ? eq(calendars.ownerId, actor.id) : isNull(calendars.deletedAt),
        or(eq(calendars.ownerId, actor.id), eq(calendarMembers.userId, actor.id)),
      ),
    );
  signal.throwIfAborted();
  return rows.map(({ calendar, memberRole }) => ({
    ...calendar,
    role: calendar.ownerId === actor.id ? ("owner" as const) : memberRole,
  }));
}

export async function updateCalendar(
  db: Db,
  actor: PermSetUser,
  raw: { id: string; name?: string; timeZone?: string },
  signal: AbortSignal,
): Promise<Result<Calendar, AppError>> {
  const parsed = calendarInput
    .partial()
    .extend({ id: calendarMemberInput.shape.calendarId })
    .safeParse(raw);
  if (!parsed.success)
    return err(new AppError(ERROR_IDS.CALENDAR_INPUT_INVALID, "invalid calendar update"));
  const { id, ...patch } = parsed.data;
  return db.transaction(async (tx) => {
    const [cal] = await tx
      .select()
      .from(calendars)
      .where(and(eq(calendars.id, id), isNull(calendars.deletedAt)))
      .for("update");
    signal.throwIfAborted();
    if (cal === undefined || !actor.isActive || cal.ownerId !== actor.id || cal.source !== "native")
      return err(new AppError(ERROR_IDS.CALENDAR_NOT_FOUND, "calendar not found"));
    if (Object.keys(patch).length === 0) return ok(cal);
    const [row] = await tx.update(calendars).set(patch).where(eq(calendars.id, id)).returning();
    signal.throwIfAborted();
    return row === undefined
      ? err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "calendar update failed"))
      : ok(row);
  });
}

export async function setCalendarArchived(
  db: Db,
  actor: PermSetUser,
  raw: { id: string; archived: boolean },
  signal: AbortSignal,
): Promise<Result<Calendar, AppError>> {
  const parsed = calendarMemberInput.pick({ calendarId: true }).safeParse({ calendarId: raw.id });
  if (!parsed.success || typeof raw.archived !== "boolean")
    return err(new AppError(ERROR_IDS.CALENDAR_INPUT_INVALID, "invalid calendar archive input"));
  return db.transaction(async (tx) => {
    const [cal] = await tx
      .select()
      .from(calendars)
      .where(eq(calendars.id, parsed.data.calendarId))
      .for("update");
    signal.throwIfAborted();
    if (cal === undefined || !actor.isActive || cal.ownerId !== actor.id || cal.source !== "native")
      return err(new AppError(ERROR_IDS.CALENDAR_NOT_FOUND, "calendar not found"));
    if (cal.isPrimary && raw.archived)
      return err(new AppError(ERROR_IDS.CALENDAR_FORBIDDEN, "primary calendar cannot be archived"));
    const [row] = await tx
      .update(calendars)
      .set({ deletedAt: raw.archived ? new Date() : null })
      .where(eq(calendars.id, cal.id))
      .returning();
    signal.throwIfAborted();
    return row === undefined
      ? err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "calendar archive update failed"))
      : ok(row);
  });
}
export async function createCalendar(
  db: Db,
  actor: PermSetUser,
  raw: { name: string; timeZone: string },
  signal: AbortSignal,
): Promise<Result<Calendar, AppError>> {
  signal.throwIfAborted();
  if (!actor.isActive) return err(new AppError(ERROR_IDS.CALENDAR_FORBIDDEN, "inactive actor"));
  const parsed = calendarInput.safeParse(raw);
  if (!parsed.success)
    return err(new AppError(ERROR_IDS.CALENDAR_INPUT_INVALID, "invalid calendar"));
  const [row] = await db
    .insert(calendars)
    .values({ ...parsed.data, ownerId: actor.id })
    .returning();
  signal.throwIfAborted();
  return row === undefined
    ? err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "calendar insert failed"))
    : ok(row);
}
export async function ensurePersonalCalendar(
  db: Db,
  actor: PermSetUser,
  timeZone: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (!actor.isActive) return;
  await db
    .insert(calendars)
    .values({ ownerId: actor.id, name: "", isPrimary: true, timeZone })
    .onConflictDoNothing();
  signal.throwIfAborted();
}
export async function setCalendarMember(
  db: Db,
  actor: PermSetUser,
  raw: { calendarId: string; userId: string; role: "freeBusy" | "reader" | "editor" | null },
  signal: AbortSignal,
): Promise<Result<undefined, AppError>> {
  const parsed = calendarMemberInput.safeParse(raw);
  if (!parsed.success)
    return err(new AppError(ERROR_IDS.CALENDAR_INPUT_INVALID, "invalid calendar member"));
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const [cal] = await tx
      .select()
      .from(calendars)
      .where(and(eq(calendars.id, input.calendarId), isNull(calendars.deletedAt)))
      .for("update");
    signal.throwIfAborted();
    if (cal === undefined || !actor.isActive || cal.ownerId !== actor.id || cal.source !== "native")
      return err(new AppError(ERROR_IDS.CALENDAR_NOT_FOUND, "calendar not found"));
    const [user] = await tx
      .select({ active: users.isActive })
      .from(users)
      .where(eq(users.id, input.userId));
    if (user?.active !== true || input.userId === cal.ownerId)
      return err(new AppError(ERROR_IDS.CALENDAR_INPUT_INVALID, "invalid calendar member"));
    if (input.role === null)
      await tx
        .delete(calendarMembers)
        .where(
          and(
            eq(calendarMembers.calendarId, input.calendarId),
            eq(calendarMembers.userId, input.userId),
          ),
        );
    else
      await tx
        .insert(calendarMembers)
        .values({ ...input, role: input.role })
        .onConflictDoUpdate({
          target: [calendarMembers.calendarId, calendarMembers.userId],
          set: { role: input.role },
        });
    signal.throwIfAborted();
    return ok(undefined);
  });
}
