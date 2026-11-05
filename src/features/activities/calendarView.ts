import { addCivilDays, civilDateRange, instantCivilDate } from "@/lib/zonedDateTime";
// URL-driven view model for the calendar: parse { view, d } at the boundary
// (invalid values fall back to defaults, never throw), pick the day window + DB
// range for the active view, and step the anchor for prev/next. Grid Date values are UTC
// civil-date containers; fetched timestamp bounds use the explicit account timezone.
import {
  addCalendarMonths,
  addCalendarYears,
  type CalendarOptions,
  calendarDateParts,
  formatCalendarDate,
  startOfCalendarMonth,
  startOfCalendarWeek,
  startOfCalendarYear,
} from "./calendarSystem";
import { addDaysUtc } from "./monthGrid";

export type CalendarViewName = "day" | "week" | "month" | "year";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00.000Z`);
  if (Number.isNaN(t)) return false;
  // Reject rolled-over values like 2026-13-40 (Date would normalize them).
  return new Date(t).toISOString().slice(0, 10) === s;
}

export function anchorDate(anchorIso: string): Date {
  return new Date(`${anchorIso}T00:00:00.000Z`);
}

export function parseCalendarParams(
  raw: { view?: string; d?: string },
  today: Date = new Date(),
  timeZone = "UTC",
): { view: CalendarViewName; anchorIso: string } {
  const view: CalendarViewName =
    raw.view === "day" || raw.view === "month" || raw.view === "year" ? raw.view : "week";
  const anchorIso =
    raw.d !== undefined && isValidIsoDate(raw.d) ? raw.d : instantCivilDate(today, timeZone);
  return { view, anchorIso };
}

export function selectWindow(
  view: CalendarViewName,
  anchorIso: string,
  options: CalendarOptions & { timeZone?: string } = {},
): { days: Date[]; range: { from: Date; to: Date } } {
  const anchor = anchorDate(anchorIso);
  if (view === "day") {
    return {
      days: [anchor],
      range: civilDateRange(anchorIso, addCivilDays(anchorIso, 1), options.timeZone),
    };
  }
  if (view === "year") {
    const start = startOfCalendarYear(anchor, options);
    const end = addCalendarYears(start, 1, options);
    const length = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    return {
      days: Array.from({ length }, (_, i) => addDaysUtc(start, i)),
      range: civilDateRange(
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
        options.timeZone,
      ),
    };
  }
  if (view === "month") {
    const start = startOfCalendarWeek(startOfCalendarMonth(anchor, options), options);
    const days = Array.from({ length: 42 }, (_, i) => addDaysUtc(start, i));
    return {
      days,
      range: civilDateRange(
        start.toISOString().slice(0, 10),
        addDaysUtc(start, 42).toISOString().slice(0, 10),
        options.timeZone,
      ),
    };
  }
  const start = startOfCalendarWeek(anchor, options);
  const days = Array.from({ length: 7 }, (_, i) => addDaysUtc(start, i));
  const first = days[0] ?? anchor;
  return {
    days,
    range: civilDateRange(
      first.toISOString().slice(0, 10),
      addCivilDays(first.toISOString().slice(0, 10), 7),
      options.timeZone,
    ),
  };
}

export function stepAnchorIso(
  view: CalendarViewName,
  anchorIso: string,
  dir: 1 | -1,
  options: CalendarOptions = {},
): string {
  const anchor = anchorDate(anchorIso);
  let next: Date;
  switch (view) {
    case "day":
      next = addDaysUtc(anchor, dir);
      break;
    case "month":
      next = addCalendarMonths(anchor, dir, options);
      break;
    case "year":
      next = addCalendarYears(anchor, dir, options);
      break;
    default:
      next = addDaysUtc(anchor, 7 * dir);
  }
  return next.toISOString().slice(0, 10);
}

export function dayTitle(anchorIso: string, options: CalendarOptions = {}): string {
  return formatCalendarDate(anchorDate(anchorIso), options, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function yearTitle(anchorIso: string, options: CalendarOptions = {}): string {
  return formatCalendarDate(anchorDate(anchorIso), options, { year: "numeric" });
}

export function monthTitle(anchorIso: string, options: CalendarOptions = {}): string {
  const d = anchorDate(anchorIso);
  if (options.locale === "fa") {
    const parts = calendarDateParts(d, options, {
      month: "long",
      year: "numeric",
    });
    return `${parts.find((part) => part.type === "month")?.value ?? ""} ${parts.find((part) => part.type === "year")?.value ?? ""}`;
  }
  return formatCalendarDate(d, options, { month: "long", year: "numeric" });
}

// Week header title: abbreviated month, day, and year (e.g. "Jun 15, 2026") so paging across
// a month or year boundary stays oriented (the old label dropped the month and year).
export function weekTitle(dayIso: string, options: CalendarOptions = {}): string {
  const d = anchorDate(dayIso);
  return formatCalendarDate(d, options, { month: "short", day: "numeric", year: "numeric" });
}

// Single source of truth for the calendar route + its query contract (view, d). Producer of
// every calendar link so a param rename stays in lock-step with parseCalendarParams.
export function calendarHref(view: CalendarViewName, dayIso: string): string {
  return `/activities/calendar?view=${view}&d=${dayIso}`;
}
