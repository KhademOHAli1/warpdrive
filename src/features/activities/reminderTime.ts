import { Temporal } from "@js-temporal/polyfill";
import { wallTimeToInstant } from "@/lib/zonedDateTime";
import { type ActivityReminderSelectionV1, activityReminderTimeZone } from "./reminderIntentTypes";

export interface ActivityReminderTimeSnapshot {
  dueAt: Date | string | null;
  allDay: boolean;
  dueDate: string | null;
  // This is the zone explicitly authored for the reminder. It is not evidence
  // of an unknown legacy event's original authored zone.
  reminderTimeZone: string | null;
}
export type ActivityReminderTimeIssue =
  | "missing_time_zone"
  | "invalid_time_zone"
  | "missing_start"
  | "invalid_start"
  | "wrong_event_kind"
  | "invalid_civil_date"
  | "invalid_wall_time";
export type ResolvedActivityReminderTime =
  | { ok: true; fireAt: string | null; ambiguous: boolean }
  | { ok: false; issue: ActivityReminderTimeIssue };

function timedFireAt(event: ActivityReminderTimeSnapshot): ResolvedActivityReminderTime {
  if (event.allDay) return { ok: false, issue: "wrong_event_kind" };
  if (event.dueAt === null) return { ok: false, issue: "missing_start" };
  const instant = event.dueAt instanceof Date ? event.dueAt.getTime() : Date.parse(event.dueAt);
  const fireAt = new Date(instant - 10 * 60_000);
  if (!Number.isFinite(fireAt.getTime())) return { ok: false, issue: "invalid_start" };
  return { ok: true, fireAt: fireAt.toISOString(), ambiguous: false };
}

function allDayFireAt(
  event: ActivityReminderTimeSnapshot,
  localTime: string,
  zone: string,
): ResolvedActivityReminderTime {
  if (!event.allDay) return { ok: false, issue: "wrong_event_kind" };
  if (event.dueDate === null) return { ok: false, issue: "missing_start" };
  try {
    const date = Temporal.PlainDate.from(event.dueDate, { overflow: "reject" });
    if (date.toString() !== event.dueDate) return { ok: false, issue: "invalid_civil_date" };
  } catch {
    return { ok: false, issue: "invalid_civil_date" };
  }
  try {
    const result = wallTimeToInstant(event.dueDate, localTime, zone);
    return { ok: true, fireAt: result.iso, ambiguous: result.ambiguous };
  } catch {
    return { ok: false, issue: "invalid_wall_time" };
  }
}

// This computes authored intent only. Eligibility and due-time delivery must use
// the database clock in the worker transaction; a past instant is not success.
export function resolveActivityReminderTime(
  event: ActivityReminderTimeSnapshot,
  selection: ActivityReminderSelectionV1,
): ResolvedActivityReminderTime {
  if (selection.kind === "none") return { ok: true, fireAt: null, ambiguous: false };
  if (event.reminderTimeZone === null) return { ok: false, issue: "missing_time_zone" };
  const zone = activityReminderTimeZone.safeParse(event.reminderTimeZone);
  if (!zone.success) return { ok: false, issue: "invalid_time_zone" };
  return selection.kind === "before_start"
    ? timedFireAt(event)
    : allDayFireAt(event, selection.localTime, zone.data);
}
