import { Temporal } from "@js-temporal/polyfill";
import {
  addCivilDays,
  civilDateRange,
  instantCivilDate,
  instantParts,
  wallTimeToInstant,
} from "@/lib/zonedDateTime";
import type {
  CalendarRescheduleMoveTarget,
  CalendarRescheduleResizeTarget,
  CalendarScheduleSnapshot,
} from "./calendarRescheduleSchemas";
import type { ActivityUpdateInput } from "./schemas";

interface CalendarScheduleSource {
  dueAt: Date | string;
  endAt?: Date | string | null;
  allDay: boolean;
  dueDate?: string | null;
  endDate?: string | null;
  durationMinutes: number | null;
}

export function calendarScheduleSnapshot(source: CalendarScheduleSource): CalendarScheduleSnapshot {
  return {
    dueAt: new Date(source.dueAt).toISOString(),
    endAt: source.endAt == null ? null : new Date(source.endAt).toISOString(),
    allDay: source.allDay,
    dueDate: source.dueDate ?? null,
    endDate: source.endDate ?? null,
    durationMinutes: source.durationMinutes,
  };
}

export function calendarScheduleMatches(
  source: Omit<CalendarScheduleSource, "dueAt"> & { dueAt: Date | string | null },
  expected: CalendarScheduleSnapshot,
): boolean {
  return (
    source.dueAt !== null &&
    new Date(source.dueAt).getTime() === Date.parse(expected.dueAt) &&
    (source.endAt == null ? null : new Date(source.endAt).getTime()) ===
      (expected.endAt === null ? null : Date.parse(expected.endAt)) &&
    source.allDay === expected.allDay &&
    (source.dueDate ?? null) === expected.dueDate &&
    (source.endDate ?? null) === expected.endDate &&
    source.durationMinutes === expected.durationMinutes
  );
}

export type CalendarReschedulePatch = Pick<
  ActivityUpdateInput,
  "dueAt" | "endAt" | "allDay" | "dueDate" | "endDate" | "durationMinutes" | "authoredTimeZone"
>;

// A move preserves event kind and stored duration representation. Timed intervals
// keep exact elapsed duration; all-day intervals keep their inclusive civil span.
// Invalid target wall times are rejected instead of shifted through a DST gap.
export function calendarReschedulePatch(
  source: CalendarScheduleSnapshot,
  target: CalendarRescheduleMoveTarget | CalendarRescheduleResizeTarget,
  timeZone: string,
): CalendarReschedulePatch | null {
  Temporal.PlainDate.from(target.date, { overflow: "reject" });
  if ("edge" in target) return resizeTimed(source, target, timeZone);
  return source.allDay ? moveAllDay(source, target, timeZone) : moveTimed(source, target, timeZone);
}

function moveAllDay(
  source: CalendarScheduleSnapshot,
  target: CalendarRescheduleMoveTarget,
  timeZone: string,
): CalendarReschedulePatch | null {
  if (target.time !== undefined)
    throw new RangeError("Cannot convert an all-day event while moving");
  const start = source.dueDate ?? instantCivilDate(source.dueAt, timeZone);
  if (target.date === start) return null;
  const hasEnd = source.endDate !== null || source.endAt !== null;
  const end =
    source.endDate ?? (source.endAt === null ? start : instantCivilDate(source.endAt, timeZone));
  const span = Temporal.PlainDate.from(start).until(Temporal.PlainDate.from(end)).days;
  if (span < 0) throw new RangeError("Invalid stored all-day span");
  const endDate = hasEnd ? addCivilDays(target.date, span) : null;
  return {
    dueAt: civilDateRange(target.date, addCivilDays(target.date, 1), timeZone).from.toISOString(),
    endAt:
      source.endAt === null || endDate === null
        ? null
        : civilDateRange(endDate, addCivilDays(endDate, 1), timeZone).from.toISOString(),
    allDay: true,
    dueDate: target.date,
    endDate,
    authoredTimeZone: timeZone,
  };
}

function moveTimed(
  source: CalendarScheduleSnapshot,
  target: CalendarRescheduleMoveTarget,
  timeZone: string,
): CalendarReschedulePatch | null {
  const local = instantParts(source.dueAt, timeZone);
  if (target.date === local.date && (target.time === undefined || target.time === local.time))
    return null;
  const sourceTime = Temporal.Instant.from(source.dueAt)
    .toZonedDateTimeISO(timeZone)
    .toPlainTime()
    .toString();
  const start = wallTimeToInstant(target.date, target.time ?? sourceTime, timeZone).iso;
  const delta = Date.parse(start) - Date.parse(source.dueAt);
  return {
    dueAt: start,
    endAt: source.endAt === null ? null : new Date(Date.parse(source.endAt) + delta).toISOString(),
    allDay: false,
    dueDate: null,
    endDate: null,
    authoredTimeZone: timeZone,
  };
}

function storedTimedEnd(source: CalendarScheduleSnapshot, start: number): number | null {
  if (source.endAt !== null) return Date.parse(source.endAt);
  return source.durationMinutes !== null && source.durationMinutes > 0
    ? start + source.durationMinutes * 60_000
    : null;
}

function resizeTimed(
  source: CalendarScheduleSnapshot,
  target: CalendarRescheduleResizeTarget,
  timeZone: string,
): CalendarReschedulePatch | null {
  if (source.allDay) throw new RangeError("Cannot resize an all-day event in the time grid");
  const previousStart = Date.parse(source.dueAt);
  const previousEnd = storedTimedEnd(source, previousStart);
  if (target.edge === "start" && previousEnd === null)
    throw new RangeError("A point event has no end to preserve");
  const previousEdge = target.edge === "start" ? previousStart : previousEnd;
  if (previousEdge !== null) {
    const local = instantParts(previousEdge, timeZone);
    if (target.date === local.date && target.time === local.time) return null;
  }
  const instant = Date.parse(wallTimeToInstant(target.date, target.time, timeZone).iso);
  const start = target.edge === "start" ? instant : previousStart;
  const end = target.edge === "end" ? instant : previousEnd;
  if (end === null || end <= start) throw new RangeError("Event end must follow its start");
  const durationMinutes = Math.ceil((end - start) / 60_000);
  if (durationMinutes > 2_147_483_647) throw new RangeError("Event duration exceeds storage range");
  return {
    ...(target.edge === "start" ? { dueAt: new Date(start).toISOString(), allDay: false } : {}),
    // The opposite instant remains exact, including a duration-only legacy endpoint.
    endAt: new Date(end).toISOString(),
    durationMinutes,
    authoredTimeZone: timeZone,
  };
}
