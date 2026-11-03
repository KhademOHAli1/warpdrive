import type { Activity } from "@/db/schema/activities";
import { addCivilDays, civilDateRange } from "@/lib/zonedDateTime";

export type ReminderDueState = "due" | "not_due" | "event_finished" | "invalid_schedule";

function eventEnd(activity: Activity, zone: string): Date | null {
  if (activity.allDay) {
    const lastDay = activity.endDate ?? activity.dueDate;
    if (lastDay === null) return null;
    try {
      return civilDateRange(lastDay, addCivilDays(lastDay, 1), zone).to;
    } catch {
      return null;
    }
  }
  if (activity.endAt !== null) return activity.endAt;
  if (activity.dueAt === null) return null;
  return new Date(activity.dueAt.getTime() + (activity.durationMinutes ?? 0) * 60_000);
}

// dbNow is sampled by the actual worker transaction, after its locks/waits.
// A delayed worker may recover a due intent while the event is still current;
// a finished event is a suppressed outcome, never a late "delivered" claim.
export function activityReminderDueState(
  activity: Activity,
  fireAt: Date,
  zone: string,
  dbNow: Date,
): ReminderDueState {
  const now = dbNow.getTime();
  const fire = fireAt.getTime();
  const end = eventEnd(activity, zone)?.getTime();
  if (!Number.isFinite(now) || !Number.isFinite(fire) || end === undefined || !Number.isFinite(end))
    return "invalid_schedule";
  if (now < fire) return "not_due";
  return now >= end ? "event_finished" : "due";
}
