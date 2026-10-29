import { addCivilDays, civilDateRange, wallTimeToInstant } from "@/lib/zonedDateTime";

// Client-side time assembly for the activity composer. Combines the date + time inputs
// into the existing dueAt (ISO) and durationMinutes fields, so the composer no longer
// hardcodes a 09:00 due time. Same-day only (no multi-day end date).

// Expects zero-padded HH:mm as emitted by <input type="time">; non-padded input
// (e.g. "9:00") is treated as invalid.
function toMinutes(time: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (m === null) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// A blank time means the user set a day, not a time. The old behaviour silently substituted
// midnight, so a time nobody chose was stored, shown back in the form, and rendered in the
// list. Callers get both the timestamp and whether a time was actually given; midnight
// deliberately picked is a real time and is NOT all-day.
export interface ComposedDueAt {
  iso: string | null;
  allDay: boolean;
  dueDate: string | null;
}

export function composeDueAt(
  startDate: string,
  startTime: string,
  timeZone = "UTC",
): ComposedDueAt {
  const iso = composeDueAtIso(startDate, startTime, timeZone);
  const allDay = iso !== null && startTime === "";
  return { iso, allDay, dueDate: allDay ? startDate : null };
}

export function composeDueAtIso(
  startDate: string,
  startTime: string,
  timeZone = "UTC",
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || (startTime !== "" && toMinutes(startTime) === null))
    return null;
  try {
    return startTime === ""
      ? civilDateRange(startDate, addCivilDays(startDate, 1), timeZone).from.toISOString()
      : wallTimeToInstant(startDate, startTime, timeZone).iso;
  } catch (error) {
    // Invalid input has historically yielded null. A valid clock time in a DST gap is an
    // actionable error: callers must show it rather than silently create an undated row.
    if (error instanceof RangeError && error.message === "nonexistent activity wall time")
      throw error;
    return null;
  }
}

export function deriveDurationMinutes(startTime: string, endTime: string): number | null {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === null || end === null) return null;
  return end > start ? end - start : null;
}
