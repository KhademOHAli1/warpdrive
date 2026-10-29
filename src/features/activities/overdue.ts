import { instantCivilDate } from "@/lib/zonedDateTime";
import { activityEndDay } from "./activityTemporal";
// All-day dates become late only after their last civil day in the account zone.
export function isActivityOverdue(
  dueAt: Date | null,
  allDay: boolean,
  done: boolean,
  now: number,
  timeZone = "UTC",
  dueDate?: string | null,
  endDate?: string | null,
  endAt?: Date | null,
): boolean {
  if (done || dueAt === null) return false;
  if (!allDay) return dueAt.getTime() < now;
  return (
    activityEndDay({ dueAt, allDay, dueDate, endDate, endAt }, timeZone)! <
    instantCivilDate(now, timeZone)
  );
}
