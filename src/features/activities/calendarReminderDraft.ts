import type { ActivityDraft } from "@/features/deal-workspace/composer/composerHelpers";
import type { EditableActivity } from "./getForEdit";
import type { ActivityReminderSelectionV1 } from "./reminderIntentTypes";

export function reminderForEventKind(
  selected: ActivityReminderSelectionV1 | null,
  allDay: boolean,
  localTime = "09:00",
): ActivityReminderSelectionV1 | null {
  if (selected === null || selected.kind === "none") return selected;
  return allDay
    ? { kind: "all_day_at", channel: "in_app", localTime }
    : { kind: "before_start", channel: "in_app", leadMinutes: 10 };
}

export function sameReminderSelection(
  a: ActivityReminderSelectionV1 | null,
  b: ActivityReminderSelectionV1 | null,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Refresh only untouched form fields. A current reminder precondition must not
// silently pair a stale, untouched schedule with another editor's new intent.
export function mergeCalendarRefresh(
  draft: ActivityDraft,
  initial: ActivityDraft,
  refreshed: ActivityDraft,
): ActivityDraft {
  const merged = { ...draft };
  for (const key of Object.keys(initial) as (keyof ActivityDraft)[]) {
    if (JSON.stringify(draft[key]) === JSON.stringify(initial[key]))
      Object.assign(merged, { [key]: refreshed[key] });
  }
  return merged;
}

export function initialCalendarReminder(
  editing?: EditableActivity,
): ActivityReminderSelectionV1 | null {
  return editing === undefined ? { kind: "none" } : (editing.reminder?.selection ?? null);
}
