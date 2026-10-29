import { instantCivilDate } from "@/lib/zonedDateTime";
import { activityDay, activityEndDay } from "./activityTemporal";
import type { CalendarActivity } from "./calendar";

export interface GroupedActivities {
  overdue: CalendarActivity[];
  today: CalendarActivity[];
  upcoming: CalendarActivity[];
}

// Partition activities into the buckets Pipedrive's activity list uses: Overdue
// (undone, before today), Today, and Upcoming. Completed past activities are
// dropped so they do not clutter the to-do list. Each bucket is sorted by due
// time ascending.
export function groupActivities(
  items: CalendarActivity[],
  now: number,
  timeZone = "UTC",
): GroupedActivities {
  const todayKey = instantCivilDate(now, timeZone);
  const out: GroupedActivities = { overdue: [], today: [], upcoming: [] };

  for (const a of items) {
    const key = activityDay(a, timeZone)!;
    const endKey = activityEndDay(a, timeZone)!;
    if (key <= todayKey && endKey >= todayKey) {
      out.today.push(a);
    } else if (endKey < todayKey) {
      if (a.done === false) out.overdue.push(a);
      // completed past activities are intentionally dropped
    } else {
      out.upcoming.push(a);
    }
  }

  const byDue = (x: CalendarActivity, y: CalendarActivity) => x.dueAt.getTime() - y.dueAt.getTime();
  out.overdue.sort(byDue);
  out.today.sort(byDue);
  out.upcoming.sort(byDue);
  return out;
}
