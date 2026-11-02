import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { activities, calendars } from "@/db/schema";

export interface BusyWindow {
  start: Date;
  end: Date;
}

interface AvailabilityQuery {
  userId: string;
  from: Date;
  to: Date;
  timeZone?: string;
}

// Read-only Free/Busy signal (Pipedrive parity, B3): the windows in [from, to] during which the
// given user is already booked by another activity assigned to them. NOT a scheduling engine, and
// deliberately coarse: it exposes only busy spans, never activity details. An activity's end is
// its explicit end_at, else due_at + durationMinutes, else due_at itself. Scoped to the user's own
// open, non-deleted assignments on active calendars (or legacy activities without a calendar).
// Finer per-record visibility is intentionally not applied because
// only busy/free (no content) is returned. Overlap uses half-open bounds (start < to, end > from).
export async function getBusyWindows(
  db: Db,
  query: AvailabilityQuery,
  signal: AbortSignal,
): Promise<BusyWindow[]> {
  signal.throwIfAborted();
  const zone = query.timeZone ?? "UTC";
  const activityStart =
    sql<Date>`case when ${activities.allDay} then coalesce(${activities.dueDate},(${activities.dueAt} at time zone ${zone}::text)::date)::timestamp at time zone ${zone}::text else ${activities.dueAt} end`.mapWith(
      activities.dueAt,
    );
  const timedEnd = sql<Date>`COALESCE(${activities.endAt}, ${activities.dueAt} + make_interval(mins => COALESCE(${activities.durationMinutes}, 0)))`;
  const activityEnd =
    sql<Date>`case when ${activities.allDay} then (coalesce(${activities.endDate},${activities.dueDate},(coalesce(${activities.endAt},${activities.dueAt}) at time zone ${zone}::text)::date)+1)::timestamp at time zone ${zone}::text else ${timedEnd} end`.mapWith(
      activities.dueAt,
    );
  const rows = await db
    .select({ start: activityStart, end: activityEnd })
    .from(activities)
    .leftJoin(calendars, eq(activities.calendarId, calendars.id))
    .where(
      and(
        eq(activities.assigneeId, query.userId),
        eq(activities.done, false),
        eq(activities.availability, "busy"),
        isNull(activities.deletedAt),
        isNull(calendars.deletedAt),
        isNotNull(activities.dueAt),
        sql`${activityStart} < ${query.to.toISOString()}`,
        sql`${activityEnd} > ${query.from.toISOString()}`,
      ),
    );
  signal.throwIfAborted();
  return rows;
}
