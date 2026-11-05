import type { CalendarActivity } from "./calendar";
import { timedCalendarSegment } from "./calendarResize";
import { HOUR_HEIGHT_PX, HOURS } from "./weekAgenda";

// Height of one chip in the all-day lane. The lane reserves a whole number of these across the
// week so every column's hour grid starts at the same y and a given hour stays level.
export const ALL_DAY_ROW_HEIGHT_PX = 22;

const WEEK_TIMED_LANES = 3;
export const MAX_ALL_DAY_ROWS = 3;

// The tallest all-day stack in the week, which is the lane height every column must reserve.
export function allDayRowCount(itemsByDay: Iterable<CalendarActivity[]>): number {
  let max = 0;
  for (const items of itemsByDay) max = Math.max(max, splitAllDay(items).allDay.length);
  return Math.min(max, MAX_ALL_DAY_ROWS);
}

// How one day's all-day stack fills the week-wide lane. Once the stack outgrows the lane the last
// row goes to the more-chip, so the overflow is always counted rather than silently clipped.
export function splitAllDayDisplay(
  items: CalendarActivity[],
  rows: number,
): { visible: CalendarActivity[]; hidden: CalendarActivity[] } {
  if (items.length <= rows) return { visible: items, hidden: [] };
  return { visible: items.slice(0, rows - 1), hidden: items.slice(rows - 1) };
}

export interface TimedPlacement {
  activity: CalendarActivity;
  topPx: number;
  heightPx: number;
  leftPct: number;
  widthPct: number;
  resizeStart: boolean;
  resizeEnd: boolean;
  // The renderer can reserve space for the overflow control in this cluster.
  overflowing: boolean;
}

// A connected group of hidden events and the vertical range it covers. The renderer positions
// the overflow control separately from the event lanes.
export interface TimedOverflow {
  activities: CalendarActivity[];
  topPx: number;
  heightPx: number;
}

// An all-day activity is stored at midnight with no duration, so the hour grid would render it as a
// 00:00 block above an empty day. It belongs in the column's own all-day lane instead.
export function splitAllDay(items: CalendarActivity[]): {
  allDay: CalendarActivity[];
  timed: CalendarActivity[];
} {
  const allDay: CalendarActivity[] = [];
  const timed: CalendarActivity[] = [];
  for (const a of items) (a.allDay ? allDay : timed).push(a);
  return { allDay, timed };
}

interface Extent {
  activity: CalendarActivity;
  topPx: number;
  heightPx: number;
  endPx: number;
  resizeStart: boolean;
  resizeEnd: boolean;
}

// Overlap is decided on the rendered extent, not the stored duration: a duration-less activity
// still paints a minimum block, so two of them at the same minute do collide on screen.
function extents(items: CalendarActivity[], timeZone: string, dayIso?: string): Extent[] {
  const visible: Extent[] = [];
  for (const activity of items) {
    const segment = timedCalendarSegment(activity, timeZone, dayIso);
    if (segment === null) continue;
    const { startMinute, endMinute, resizeStart, resizeEnd } = segment;
    const topPx = (startMinute * HOUR_HEIGHT_PX) / 60;
    const endPx = Math.min(
      HOURS.length * HOUR_HEIGHT_PX,
      Math.max(topPx + HOUR_HEIGHT_PX / 2, (endMinute * HOUR_HEIGHT_PX) / 60),
    );
    visible.push({ activity, topPx, heightPx: endPx - topPx, endPx, resizeStart, resizeEnd });
  }
  return visible.sort(
    (a, b) => a.topPx - b.topPx || b.endPx - a.endPx || a.activity.id.localeCompare(b.activity.id),
  );
}

// A cluster is a run of activities connected by overlap: each one starts before everything already
// in the run has ended. Width is decided per cluster, so a busy morning does not shrink an
// afternoon that happens to be free.
function clusters(sorted: Extent[]): Extent[][] {
  const out: Extent[][] = [];
  let current: Extent[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  for (const e of sorted) {
    if (current.length > 0 && e.topPx >= clusterEnd) {
      out.push(current);
      current = [];
      clusterEnd = Number.NEGATIVE_INFINITY;
    }
    current.push(e);
    clusterEnd = Math.max(clusterEnd, e.endPx);
  }
  if (current.length > 0) out.push(current);
  return out;
}

// Greedy lane assignment: take the lowest lane whose last activity has already ended, so a gap
// inside a cluster is reused rather than costing every activity in it another column.
function assignLanes(cluster: Extent[]): { lanes: number[]; laneCount: number } {
  const laneEnds: number[] = [];
  const lanes = cluster.map((e) => {
    const lane = laneEnds.findIndex((end) => e.topPx >= end);
    const index = lane === -1 ? laneEnds.length : lane;
    laneEnds[index] = e.endPx;
    return index;
  });
  return { lanes, laneCount: laneEnds.length };
}

function layoutCluster(
  cluster: Extent[],
  maxLanes: number,
  placements: TimedPlacement[],
  overflows: TimedOverflow[],
): void {
  const { lanes, laneCount } = assignLanes(cluster);
  const overflowing = laneCount > maxLanes;
  const shownLanes = Math.min(laneCount, maxLanes);
  const widthPct = 100 / shownLanes;
  const hidden: Extent[] = [];
  cluster.forEach((e, i) => {
    const lane = lanes[i] ?? 0;
    if (lane >= shownLanes) {
      hidden.push(e);
      return;
    }
    placements.push({
      activity: e.activity,
      topPx: e.topPx,
      heightPx: e.heightPx,
      leftPct: widthPct * lane,
      widthPct,
      resizeStart: e.resizeStart,
      resizeEnd: e.resizeEnd,
      overflowing,
    });
  });
  // A long visible event can bridge multiple crowded periods. Show a separate count
  // at each period so an early control does not include hidden events from later on.
  for (const group of clusters(hidden)) {
    const topPx = Math.min(...group.map((e) => e.topPx));
    const endPx = Math.max(...group.map((e) => e.endPx));
    overflows.push({
      activities: group.map((e) => e.activity),
      topPx,
      heightPx: endPx - topPx,
    });
  }
}

export function layoutTimed(
  items: CalendarActivity[],
  timeZone = "UTC",
  dayIso?: string,
  maxLanes = WEEK_TIMED_LANES,
): {
  placements: TimedPlacement[];
  overflows: TimedOverflow[];
} {
  const placements: TimedPlacement[] = [];
  const overflows: TimedOverflow[] = [];
  for (const cluster of clusters(extents(items, timeZone, dayIso)))
    layoutCluster(cluster, maxLanes, placements, overflows);
  return { placements, overflows };
}
