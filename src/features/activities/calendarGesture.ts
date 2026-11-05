import { Temporal } from "@js-temporal/polyfill";
import { addCivilDays, instantParts, wallTimeToInstant } from "@/lib/zonedDateTime";
import { activityDay, activityEndDay } from "./activityTemporal";
import type { CalendarActivity } from "./calendar";

export interface CalendarPoint {
  date: string;
  minute: number;
  kind: "time" | "date";
}

export interface CalendarSelection {
  date: string;
  time?: string;
  endDate: string;
  endTime?: string;
  // Positive fallback height when a repeated hour puts the end at or before the start
  // on the wall-clock grid. This is never mutation input.
  elapsedMinutes?: number;
}

export interface CalendarMoveTarget {
  date: string;
  time?: string;
}

const SLOT_MINUTES = 15;
const DAY_MINUTES = 1440;

export function snapCalendarMinute(offsetPx: number, heightPx: number): number {
  if (!Number.isFinite(offsetPx) || !Number.isFinite(heightPx) || heightPx <= 0) return 0;
  const fraction = Math.max(0, Math.min(1, offsetPx / heightPx));
  return Math.min(
    DAY_MINUTES - SLOT_MINUTES,
    Math.floor((fraction * DAY_MINUTES) / SLOT_MINUTES) * SLOT_MINUTES,
  );
}

function pointDateTime(point: CalendarPoint): Temporal.PlainDateTime {
  if (!Number.isFinite(point.minute) || point.minute < 0 || point.minute >= DAY_MINUTES)
    throw new RangeError("invalid calendar pointer minute");
  const minute = Math.floor(point.minute / SLOT_MINUTES) * SLOT_MINUTES;
  return Temporal.PlainDate.from(point.date).toPlainDateTime().add({ minutes: minute });
}

function dateTimeParts(value: Temporal.PlainDateTime): { date: string; time: string } {
  return {
    date: value.toPlainDate().toString(),
    time: `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`,
  };
}

export function calendarSelection(
  origin: CalendarPoint,
  target: CalendarPoint,
): CalendarSelection | null {
  if (origin.kind !== target.kind) return null;
  try {
    if (origin.kind === "date") {
      const first = Temporal.PlainDate.from(origin.date);
      const last = Temporal.PlainDate.from(target.date);
      return Temporal.PlainDate.compare(first, last) <= 0
        ? { date: first.toString(), endDate: last.toString() }
        : { date: last.toString(), endDate: first.toString() };
    }
    const first = pointDateTime(origin);
    const last = pointDateTime(target);
    const forward = Temporal.PlainDateTime.compare(first, last) <= 0;
    const start = dateTimeParts(forward ? first : last);
    const end = dateTimeParts((forward ? last : first).add({ minutes: SLOT_MINUTES }));
    return { ...start, endDate: end.date, endTime: end.time };
  } catch {
    return null;
  }
}

function dayDifference(origin: string, target: string): number {
  return Temporal.PlainDate.from(origin).until(Temporal.PlainDate.from(target), {
    largestUnit: "days",
  }).days;
}

function validateTimedTarget(
  original: { date: string; time: string },
  target: { date: string; time: string },
  timeZone: string,
): void {
  if (original.date !== target.date || original.time !== target.time)
    wallTimeToInstant(target.date, target.time, timeZone);
}

function exactWallTime(activity: CalendarActivity, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(activity.dueAt.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainTime()
    .toString({ smallestUnit: "millisecond" });
}

export function calendarMoveTarget(
  activity: CalendarActivity,
  origin: CalendarPoint,
  target: CalendarPoint,
  timeZone: string,
): CalendarMoveTarget | null {
  if (origin.kind !== target.kind || (activity.allDay && target.kind === "time")) return null;
  try {
    const startDate = activityDay(activity, timeZone);
    if (target.kind === "date") {
      const date = addCivilDays(startDate, dayDifference(origin.date, target.date));
      if (!activity.allDay) {
        const start = instantParts(activity.dueAt, timeZone);
        if (date !== start.date)
          wallTimeToInstant(date, exactWallTime(activity, timeZone), timeZone);
      }
      return { date };
    }
    const delta = pointDateTime(origin).until(pointDateTime(target), {
      largestUnit: "minutes",
    }).minutes;
    const start = instantParts(activity.dueAt, timeZone);
    const moved = Temporal.PlainDateTime.from(`${start.date}T${start.time}`).add({
      minutes: delta,
    });
    const destination = dateTimeParts(moved);
    validateTimedTarget(start, destination, timeZone);
    return destination;
  } catch {
    return null;
  }
}

function selectionEnd(
  selection: CalendarSelection,
  start: Temporal.PlainDateTime,
): Temporal.PlainDateTime {
  if (selection.elapsedMinutes === undefined)
    return Temporal.PlainDateTime.from(`${selection.endDate}T${selection.endTime}`);
  if (!Number.isFinite(selection.elapsedMinutes) || selection.elapsedMinutes <= 0)
    throw new RangeError("invalid calendar preview duration");
  return start.add({ milliseconds: Math.round(selection.elapsedMinutes * 60_000) });
}

export function selectionSegments(
  selection: CalendarSelection,
  dayIso: string,
): { startMinute: number; endMinute: number } | null {
  try {
    const day = Temporal.PlainDate.from(dayIso);
    if (selection.time === undefined || selection.endTime === undefined) {
      if (selection.time !== undefined || selection.endTime !== undefined) return null;
      const start = Temporal.PlainDate.from(selection.date);
      const end = Temporal.PlainDate.from(selection.endDate);
      return Temporal.PlainDate.compare(day, start) >= 0 &&
        Temporal.PlainDate.compare(day, end) <= 0
        ? { startMinute: 0, endMinute: DAY_MINUTES }
        : null;
    }
    const start = Temporal.PlainDateTime.from(`${selection.date}T${selection.time}`);
    const end = selectionEnd(selection, start);
    const dayStart = day.toPlainDateTime();
    const dayEnd = dayStart.add({ days: 1 });
    if (
      Temporal.PlainDateTime.compare(end, start) <= 0 ||
      Temporal.PlainDateTime.compare(end, dayStart) <= 0 ||
      Temporal.PlainDateTime.compare(start, dayEnd) >= 0
    )
      return null;
    const first = Temporal.PlainDateTime.compare(start, dayStart) < 0 ? dayStart : start;
    const last = Temporal.PlainDateTime.compare(end, dayEnd) > 0 ? dayEnd : end;
    return {
      startMinute: dayStart.until(first, { largestUnit: "minutes" }).total({ unit: "minutes" }),
      endMinute: dayStart.until(last, { largestUnit: "minutes" }).total({ unit: "minutes" }),
    };
  } catch {
    return null;
  }
}

function previewDuration(activity: CalendarActivity): number | null {
  const explicit = activity.endAt == null ? 0 : activity.endAt.getTime() - activity.dueAt.getTime();
  if (explicit > 0) return explicit;
  return activity.durationMinutes !== null && activity.durationMinutes > 0
    ? activity.durationMinutes * 60_000
    : null;
}

export function movePreviewSelection(
  activity: CalendarActivity,
  target: CalendarMoveTarget,
  timeZone: string,
): CalendarSelection | null {
  try {
    if (activity.allDay) {
      if (target.time !== undefined) return null;
      const days = dayDifference(
        activityDay(activity, timeZone),
        activityEndDay(activity, timeZone),
      );
      if (days < 0) return null;
      return { date: target.date, endDate: addCivilDays(target.date, days) };
    }
    const original = instantParts(activity.dueAt, timeZone);
    const start = { date: target.date, time: target.time ?? original.time };
    const unchanged = start.date === original.date && start.time === original.time;
    const at = unchanged
      ? activity.dueAt.getTime()
      : Date.parse(
          wallTimeToInstant(start.date, target.time ?? exactWallTime(activity, timeZone), timeZone)
            .iso,
        );
    const duration = previewDuration(activity);
    if (duration === null) {
      const local = Temporal.PlainDateTime.from(`${start.date}T${start.time}`);
      const remaining = DAY_MINUTES - (local.hour * 60 + local.minute);
      const end = dateTimeParts(local.add({ minutes: Math.min(30, remaining) }));
      return { ...start, endDate: end.date, endTime: end.time };
    }
    const end = instantParts(at + duration, timeZone);
    const selection: CalendarSelection = { ...start, endDate: end.date, endTime: end.time };
    if (end.date < start.date || (end.date === start.date && end.time <= start.time))
      selection.elapsedMinutes = duration / 60_000;
    return selection;
  } catch {
    return null;
  }
}
