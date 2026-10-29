import { activityParts } from "./activityTemporal";
import { composeDueAt } from "./activityTime";
import type { ActivityUpdateInput } from "./schemas";

// The activity fields ActivityEditModal can prefill and patch. Callers (ActivitiesTable,
// the calendar chip) map their own row/chip shape onto this; fields not tracked by the
// caller's source (durationMinutes, location) default to null, which is safe because Save
// only sends fields the user actually changed (see buildActivityPatch), never clobbering an
// unseen existing value.
export interface EditableActivity {
  id: string;
  subject: string;
  typeId: string;
  priority: string | null;
  dueAtIso: string | null;
  allDay: boolean;
  dueDate?: string | null;
  endDate?: string | null;
  durationMinutes: number | null;
  location: string | null;
  done: boolean;
  assigneeId?: string | null;
}

export interface EditFormState {
  subject: string;
  typeId: string;
  priority: string;
  date: string;
  time: string;
  location: string;
}

// Explicit account-zone projection for minute inputs. Saving compares these inputs before
// converting, so untouched seconds, milliseconds and repeated-hour offsets survive exactly.
export function isoToLocalParts(
  iso: string | null,
  allDay = false,
  timeZone = "UTC",
  dueDate?: string | null,
): { date: string; time: string } {
  const { date, time } = activityParts({ dueAtIso: iso, allDay, dueDate }, timeZone);
  return { date, time };
}

// Diffs the edit form's current state against the original activity and returns only the
// changed fields (plus id), so an untouched field never overwrites existing data with an
// implicit value. Returns null when nothing changed (Save then just closes, no network call).
export function buildActivityPatch(
  activity: EditableActivity,
  state: EditFormState,
  timeZone = "UTC",
): ActivityUpdateInput | null {
  const patch: ActivityUpdateInput = { id: activity.id };
  let changed = false;

  const subject = state.subject.trim();
  if (subject !== activity.subject) {
    patch.subject = subject;
    changed = true;
  }
  if (state.typeId !== activity.typeId) {
    patch.typeId = state.typeId;
    changed = true;
  }
  const priority = state.priority === "" ? null : state.priority;
  if (priority !== activity.priority) {
    patch.priority = priority;
    changed = true;
  }
  // The flag rides with the timestamp: removing a time from an existing activity has to
  // actually remove it, not leave the old midnight behind looking chosen.
  const initial = isoToLocalParts(activity.dueAtIso, activity.allDay, timeZone, activity.dueDate);
  if (state.date !== initial.date || state.time !== initial.time) {
    const { iso: dueAt, allDay, dueDate } = composeDueAt(state.date, state.time, timeZone);
    patch.dueAt = dueAt;
    patch.allDay = allDay;
    patch.dueDate = dueDate;
    if (!allDay) patch.endDate = null;
    changed = true;
  }
  const location = state.location.trim() === "" ? null : state.location.trim();
  if (location !== activity.location) {
    patch.location = location;
    changed = true;
  }
  return changed ? patch : null;
}
