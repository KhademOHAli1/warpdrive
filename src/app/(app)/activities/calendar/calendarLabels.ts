import {
  type CalendarOptions,
  calendarDateParts,
  formatCalendarDate,
} from "@/features/activities/calendarSystem";
import { isoToDayHeading, isoToDayLabel } from "@/features/activities/dayHeading";
import { hourLabel, startTimeLabel } from "@/features/activities/weekAgenda";
import { displayNumberingSystem } from "@/lib/numberingSystem";

export function calendarDayHeading(iso: string, options: CalendarOptions): string {
  if (options.locale !== "fa" && options.locale !== "de" && options.calendar !== "persian")
    return isoToDayHeading(iso);
  const day = new Date(`${iso}T00:00:00Z`);
  return `${formatCalendarDate(day, options, { weekday: "short" })} ${formatCalendarDate(day, options, { day: "numeric" })}`;
}

export function calendarDayLabel(iso: string, options: CalendarOptions): string {
  if (options.locale !== "fa" && options.locale !== "de" && options.calendar !== "persian")
    return isoToDayLabel(iso);
  const date = new Date(`${iso}T00:00:00Z`);
  const format = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  } as const;
  if (options.locale === "fa") {
    const parts = calendarDateParts(date, options, format);
    const part = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((value) => value.type === type)?.value ?? "";
    return `${part("weekday")}، ${part("day")} ${part("month")} ${part("year")}`;
  }
  return formatCalendarDate(date, options, format);
}

function localizeTimeDigits(value: string, options: CalendarOptions): string {
  if (displayNumberingSystem(options) === "latn") return value;
  return value.replace(/\d/g, (digit) =>
    new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(Number(digit)),
  );
}

// These are wall-clock hours in the existing agenda timezone. Changing the display calendar
// or language must not reinterpret the timestamp or move an activity into another hour lane.
export function calendarHourLabel(hour: number, options: CalendarOptions): string {
  return localizeTimeDigits(hourLabel(hour), options);
}

export function calendarStartTimeLabel(
  dueAt: Date,
  options: CalendarOptions & { timeZone?: string },
): string {
  return localizeTimeDigits(startTimeLabel(dueAt, options.timeZone), options);
}
