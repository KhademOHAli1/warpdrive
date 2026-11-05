import { Temporal } from "@js-temporal/polyfill";
import { addCivilDays, instantParts, wallTimeToInstant } from "@/lib/zonedDateTime";
import type { CalendarActivity } from "./calendar";
import type { CalendarPoint, CalendarSelection } from "./calendarGesture";

export type CalendarResizeEdge = "start" | "end";

export interface CalendarResizeTarget {
  edge: CalendarResizeEdge;
  date: string;
  time: string;
}

const SLOT_MINUTES = 15;
const DAY_MINUTES = 1440;
const MINUTE_MS = 60_000;
const POINT_PREVIEW_MINUTES = 30;

export function snapCalendarResizeMinute(offsetPx: number, heightPx: number): number {
  if (!Number.isFinite(offsetPx) || !Number.isFinite(heightPx) || heightPx <= 0) return 0;
  const fraction = Math.max(0, Math.min(1, offsetPx / heightPx));
  return Math.round((fraction * DAY_MINUTES) / SLOT_MINUTES) * SLOT_MINUTES;
}

function scheduledEnd(activity: CalendarActivity): number | null {
  if (activity.endAt != null) return activity.endAt.getTime();
  const duration = activity.durationMinutes;
  return duration !== null && Number.isFinite(duration) && duration > 0
    ? activity.dueAt.getTime() + duration * MINUTE_MS
    : null;
}

function wallPoint(at: number, timeZone: string): { date: string; minute: number } {
  const wall = Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(timeZone);
  return {
    date: wall.toPlainDate().toString(),
    minute: wall.hour * 60 + wall.minute + wall.second / 60 + wall.millisecond / MINUTE_MS,
  };
}

function civilMinute(date: string, minute: number): Temporal.PlainDateTime {
  if (
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > DAY_MINUTES ||
    minute % SLOT_MINUTES !== 0
  )
    throw new RangeError("Invalid resize pointer minute");
  return Temporal.PlainDate.from(date).toPlainDateTime().add({ minutes: minute });
}

function resizeSelection(startAt: number, endAt: number, timeZone: string): CalendarSelection {
  const start = instantParts(startAt, timeZone);
  const end = instantParts(endAt, timeZone);
  const sameOrEarlierWallEnd =
    end.date < start.date || (end.date === start.date && end.time <= start.time);
  return {
    date: start.date,
    time: start.time,
    endDate: end.date,
    endTime: end.time,
    // A fall-back overlap can make a positive interval appear inverted on a 24-hour grid.
    elapsedMinutes: sameOrEarlierWallEnd ? (endAt - startAt) / MINUTE_MS : undefined,
  };
}

export function calendarResizeTarget(
  activity: CalendarActivity,
  edge: CalendarResizeEdge,
  origin: CalendarPoint,
  point: CalendarPoint,
  timeZone: string,
): { target: CalendarResizeTarget; selection: CalendarSelection; changed: boolean } | null {
  if (activity.allDay || origin.kind !== "time" || point.kind !== "time") return null;
  try {
    const startAt = activity.dueAt.getTime();
    const storedEnd = scheduledEnd(activity);
    if (edge === "start" && storedEnd === null) return null;
    const endAt = storedEnd ?? startAt + POINT_PREVIEW_MINUTES * MINUTE_MS;
    if (endAt <= startAt) return null;
    const delta = civilMinute(origin.date, origin.minute).until(
      civilMinute(point.date, point.minute),
      { largestUnit: "minutes" },
    ).minutes;
    const edgeAt = edge === "start" ? startAt : endAt;
    const original = wallPoint(edgeAt, timeZone);
    // Grips sit inside the block, which may be taller than a short event. Apply the
    // pointer displacement to the actual endpoint before snapping to the grid.
    const snapped = Math.round(original.minute / SLOT_MINUTES) * SLOT_MINUTES;
    const next = civilMinute(original.date, snapped).add({ minutes: delta });
    const target = {
      edge,
      date: next.toPlainDate().toString(),
      time: next.toPlainTime().toString({ smallestUnit: "minute" }),
    };
    const previous = instantParts(edgeAt, timeZone);
    const changed = delta !== 0 && (target.date !== previous.date || target.time !== previous.time);
    const nextAt = changed
      ? Date.parse(wallTimeToInstant(target.date, target.time, timeZone).iso)
      : edgeAt;
    const start = edge === "start" ? nextAt : startAt;
    const end = edge === "end" ? nextAt : endAt;
    if (end <= start) return null;
    return { target, selection: resizeSelection(start, end, timeZone), changed };
  } catch {
    return null;
  }
}

interface TimedCalendarSegment {
  startMinute: number;
  endMinute: number;
  resizeStart: boolean;
  resizeEnd: boolean;
}

// Paint each day's own part of a timed interval. A continuation edge at midnight is
// a clip boundary, and only the segment containing the actual endpoint gets a grip.
export function timedCalendarSegment(
  activity: CalendarActivity,
  timeZone: string,
  dayIso?: string,
): TimedCalendarSegment | null {
  const startAt = activity.dueAt.getTime();
  const start = wallPoint(startAt, timeZone);
  const day = dayIso ?? start.date;
  const endAt = scheduledEnd(activity);
  const startMinute = day === start.date ? Math.floor(start.minute) : 0;
  if (endAt === null || !Number.isFinite(endAt) || endAt <= startAt) {
    return day === start.date
      ? {
          startMinute,
          endMinute: Math.min(DAY_MINUTES, startMinute + POINT_PREVIEW_MINUTES),
          resizeStart: false,
          resizeEnd: endAt === null,
        }
      : null;
  }
  const end = wallPoint(endAt, timeZone);
  if (day < start.date || day > end.date) return null;
  if (day === start.date && day === end.date && end.minute <= start.minute) {
    return {
      startMinute,
      endMinute: Math.min(DAY_MINUTES, startMinute + (endAt - startAt) / MINUTE_MS),
      resizeStart: true,
      resizeEnd: false,
    };
  }
  const endMinute = day === end.date ? end.minute : DAY_MINUTES;
  if (endMinute <= startMinute) return null;
  return {
    startMinute,
    endMinute,
    resizeStart: day === start.date,
    resizeEnd: day === end.date || (end.minute === 0 && addCivilDays(day, 1) === end.date),
  };
}
