import { instantCivilDate, instantParts } from "@/lib/zonedDateTime";
import { activityDay, activityEndDay } from "./activityTemporal";
import type { CalendarActivity } from "./calendar";

const DAY_START_HOUR = 0;
const DAY_END_HOUR = 24;
export const HOUR_HEIGHT_PX = 48;
const MIN_HEIGHT_PX = HOUR_HEIGHT_PX / 2;

export const HOURS: number[] = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR },
  (_, i) => DAY_START_HOUR + i,
);

// One template for the header row, the all-day row and the scrolling hour region, so the time
// gutter and the seven day columns share one set of tracks instead of three that can drift.
export const AGENDA_GRID_COLS = "3.25rem repeat(7, minmax(0, 1fr))";
export const AGENDA_GUTTER_WIDTH = "3.25rem";

// 24-hour labels, matching the "HH:mm" the composer's TimePicker reads and writes.
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

// An activity's own start, in the same local frame and the same "HH:mm" shape.
export function startTimeLabel(dueAt: Date, timeZone = "UTC"): string {
  return instantParts(dueAt, timeZone).time;
}

// Vertical placement of a timed activity block in the hourly week grid. Uses the viewer's
// local hours (dueAt is a Date; the grid is a local-time agenda). Placement is purely a
// function of the activity's own dueAt/duration: it does not resolve overlap against other
// activities (no horizontal lane assignment). Two activities whose time ranges overlap are
// placed independently and may render stacked; WeekAgendaGrid, not this module, owns any
// visual layering (z-index) for that case.
export function placeBlock(
  dueAt: Date,
  durationMinutes: number | null,
  timeZone = "UTC",
): { topPx: number; heightPx: number } {
  const [hour, minute] = instantParts(dueAt, timeZone).time.split(":").map(Number);
  const minutesFromMidnight = (hour ?? 0) * 60 + (minute ?? 0);
  const topPx = (minutesFromMidnight / 60) * HOUR_HEIGHT_PX;
  const heightPx =
    durationMinutes !== null
      ? Math.max((durationMinutes / 60) * HOUR_HEIGHT_PX, MIN_HEIGHT_PX)
      : MIN_HEIGHT_PX;
  return { topPx, heightPx };
}

// Prefill values for click-to-create in a given day column + hour lane.
export function slotDateTime(dayIso: string, hour: number): { date: string; time: string } {
  return { date: dayIso, time: `${String(hour).padStart(2, "0")}:00` };
}

// Account-zone civil day key; the month grid and list use the same projection.
export function localDayIso(d: Date, timeZone = "UTC"): string {
  return instantCivilDate(d, timeZone);
}

// Canonical all-day dates remain fixed; timed and legacy rows project in the account zone.
export function groupByLocalDay(
  activities: CalendarActivity[],
  dayIsos: string[],
  includeOverdue = false,
  timeZone = "UTC",
): Map<string, CalendarActivity[]> {
  const map = new Map<string, CalendarActivity[]>();
  for (const iso of dayIsos) map.set(iso, []);
  for (const a of activities) {
    if (!includeOverdue && a.overdue === true) continue;
    // Multi-day activities (endAt set) span every local day in [dueAt, endAt]; local "YYYY-MM-DD"
    // strings compare lexically as dates. Single-day activities keep their one-day behavior.
    const startKey = activityDay(a, timeZone);
    const endKey = activityEndDay(a, timeZone);
    for (const iso of dayIsos) {
      if (iso >= startKey && iso <= endKey) map.get(iso)?.push(a);
    }
  }
  return map;
}
