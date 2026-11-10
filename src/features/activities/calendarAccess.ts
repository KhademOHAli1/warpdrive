import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { activities, calendarMembers, calendars } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import type { AuthUser } from "@/features/permissions/types";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { CalendarRole } from "./calendarSchemas";
import { calendarRole } from "./calendars";

export interface CalendarAccess {
  read: boolean;
  write: boolean;
  freeBusy: boolean;
}
function permissions(role: CalendarRole | null, visibility: string): CalendarAccess {
  const write = role === "owner" || role === "editor";
  return {
    write,
    read: write || (role === "reader" && visibility !== "private"),
    freeBusy: role !== null,
  };
}
export async function calendarActivityAccess(
  db: DbOrTx,
  actor: PermSetUser,
  row: { calendarId: string | null; eventVisibility: string },
  signal: AbortSignal,
  lock = false,
): Promise<CalendarAccess | null> {
  if (row.calendarId === null) return null;
  return permissions(
    await calendarRole(db, actor, row.calendarId, signal, lock),
    row.eventVisibility,
  );
}
export async function loadCalendarAccess(
  db: DbOrTx,
  actor: AuthUser,
  ids: string[],
  signal: AbortSignal,
): Promise<Map<string, CalendarAccess>> {
  const result = new Map<string, CalendarAccess>();
  if (ids.length === 0) return result;
  const rows = await db
    .select({
      id: activities.id,
      visibility: activities.eventVisibility,
      owner: calendars.ownerId,
      source: calendars.source,
      deletedAt: calendars.deletedAt,
      role: calendarMembers.role,
    })
    .from(activities)
    .innerJoin(calendars, eq(activities.calendarId, calendars.id))
    .leftJoin(
      calendarMembers,
      and(eq(calendarMembers.calendarId, calendars.id), eq(calendarMembers.userId, actor.id)),
    )
    .where(inArray(activities.id, ids));
  signal.throwIfAborted();
  for (const row of rows) {
    const role =
      !actor.isActive || row.deletedAt !== null || row.source !== "native"
        ? null
        : row.owner === actor.id || actor.type === "admin"
          ? "owner"
          : row.role;
    result.set(row.id, permissions(role, row.visibility));
  }
  return result;
}
// Calendar grants apply only to standalone activities. CRM parent permissions remain authoritative.
export async function calendarReaders(
  db: DbOrTx,
  ids: string[],
  signal: AbortSignal,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (ids.length === 0) return result;
  const rows = await db
    .select({
      id: activities.id,
      visibility: activities.eventVisibility,
      owner: calendars.ownerId,
      userId: calendarMembers.userId,
      role: calendarMembers.role,
    })
    .from(activities)
    .innerJoin(
      calendars,
      and(
        eq(activities.calendarId, calendars.id),
        isNull(calendars.deletedAt),
        eq(calendars.source, "native"),
      ),
    )
    .leftJoin(calendarMembers, eq(calendarMembers.calendarId, calendars.id))
    .where(
      and(
        inArray(activities.id, ids),
        isNotNull(activities.calendarId),
        isNull(activities.dealId),
        isNull(activities.leadId),
        isNull(activities.personId),
        isNull(activities.orgId),
      ),
    );
  signal.throwIfAborted();
  for (const row of rows) {
    const allowed = result.get(row.id) ?? [];
    allowed.push(row.owner);
    if (row.userId !== null && permissions(row.role, row.visibility).read) allowed.push(row.userId);
    result.set(row.id, Array.from(new Set(allowed)));
  }
  return result;
}
export function standaloneCalendarWriter(
  row: {
    dealId: string | null;
    personId: string | null;
    orgId: string | null;
    leadId: string | null;
  },
  access: CalendarAccess | null,
): boolean {
  return (
    access?.write === true &&
    row.dealId === null &&
    row.leadId === null &&
    row.personId === null &&
    row.orgId === null
  );
}
