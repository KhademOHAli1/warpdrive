import { Temporal } from "@js-temporal/polyfill";
import {
  type ActivityDraft,
  composedTemporal,
  localPartsFromIso,
} from "@/features/deal-workspace/composer/composerHelpers";
import { addCivilDays, instantParts, wallTimeToInstant } from "@/lib/zonedDateTime";
import type { EditableActivity } from "./getForEdit";
import { isBlankHtml } from "./isBlankHtml";
import type { ActivityUpdateInput } from "./schemas";

export function calendarEventDraft({
  date = "",
  time = "",
  editing,
  timeZone,
}: {
  date?: string;
  time?: string;
  editing?: EditableActivity;
  timeZone: string;
}): ActivityDraft {
  const start =
    editing === undefined
      ? { date, time }
      : localPartsFromIso(editing.dueAt, editing.allDay, timeZone, editing.dueDate);
  let end = { date: start.date, time: "" };
  if (editing !== undefined) {
    const endAt =
      editing.endAt ??
      (editing.dueAt !== null && editing.durationMinutes !== null
        ? new Date(Date.parse(editing.dueAt) + editing.durationMinutes * 60_000).toISOString()
        : null);
    end = localPartsFromIso(endAt, editing.allDay, timeZone, editing.endDate);
    if (editing.allDay) end.date = editing.endDate ?? start.date;
  } else if (time !== "" && date !== "") {
    try {
      const at = wallTimeToInstant(date, time, timeZone);
      end = instantParts(Date.parse(at.iso) + 60 * 60_000, timeZone);
    } catch {
      end.time = time;
    }
  }
  return {
    typeId: editing?.typeId ?? "",
    subject: editing?.subject ?? "",
    priority: editing?.priority ?? "",
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    links: {
      deal: editing?.dealId ?? null,
      person: editing?.personId ?? null,
      org: editing?.orgId ?? null,
    },
    leadId: null,
    location: editing?.location ?? "",
    note: editing?.note ?? "",
    videoCallUrl: editing?.videoCallUrl ?? "",
    done: editing?.done ?? false,
    ownerId: editing?.assigneeId ?? "",
    participants: editing?.guestPersonIds ?? [],
  };
}

export type CalendarEventIssue =
  | "subjectRequired"
  | "typeUnavailable"
  | "dateRequired"
  | "invalidDate"
  | "invalidTime"
  | "invalidWallTime"
  | "endBeforeStart"
  | "invalidMeetingUrl";

export function calendarEventIssue(
  d: ActivityDraft,
  timeZone: string,
  stored?: EditableActivity,
): CalendarEventIssue | null {
  if (d.subject.trim() === "") return "subjectRequired";
  if (d.typeId === "") return "typeUnavailable";
  if (d.startDate === "") return "dateRequired";
  const inputIssue = calendarInputIssue(d);
  if (inputIssue !== null) return inputIssue;
  return calendarRangeIssue(d, timeZone, stored);
}

function calendarInputIssue(d: ActivityDraft): CalendarEventIssue | null {
  try {
    Temporal.PlainDate.from(d.startDate, { overflow: "reject" });
    if (d.endDate !== "") Temporal.PlainDate.from(d.endDate, { overflow: "reject" });
  } catch {
    return "invalidDate";
  }
  for (const time of [d.startTime, d.endTime]) {
    if (time !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return "invalidTime";
  }
  if (d.startTime !== "" && d.endDate !== "" && d.endTime === "") return "invalidTime";
  return validMeetingLink(d.videoCallUrl) ? null : "invalidMeetingUrl";
}

function validMeetingLink(link: string): boolean {
  if (link === "") return true;
  try {
    const url = new URL(link);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function calendarRangeIssue(
  d: ActivityDraft,
  timeZone: string,
  stored?: EditableActivity,
): CalendarEventIssue | null {
  try {
    const bounds = eventBounds(d, timeZone, stored);
    if (d.startTime === "")
      return d.endDate !== "" && d.endDate < d.startDate ? "endBeforeStart" : null;
    // Calendar events require a positive end when an end has been entered. Existing point
    // activities remain editable without fabricating an end time on an unrelated change.
    if (
      bounds.start !== null &&
      bounds.end !== null &&
      Date.parse(bounds.end) <= Date.parse(bounds.start)
    )
      return "endBeforeStart";
  } catch {
    return "invalidWallTime";
  }
  return null;
}

function eventBounds(d: ActivityDraft, timeZone: string, stored?: EditableActivity) {
  const initial = stored === undefined ? null : calendarEventDraft({ editing: stored, timeZone });
  const startChanged =
    initial === null || d.startDate !== initial.startDate || d.startTime !== initial.startTime;
  const endChanged =
    initial === null || d.endDate !== initial.endDate || d.endTime !== initial.endTime;
  const temporal = composedTemporal(d, timeZone);
  const start = startChanged ? temporal.dueAt : (stored?.dueAt ?? null);
  let end = temporal.endAt;
  if (!endChanged && stored !== undefined) {
    end =
      stored.endAt ??
      (stored.dueAt !== null && stored.durationMinutes !== null
        ? new Date(Date.parse(stored.dueAt) + stored.durationMinutes * 60_000).toISOString()
        : null);
  } else if (!temporal.allDay && d.endTime !== "") {
    end = wallTimeToInstant(d.endDate || d.startDate, d.endTime, timeZone).iso;
  }
  return { temporal, startChanged, endChanged, start, end };
}

function calendarTemporalPatch(
  stored: EditableActivity,
  d: ActivityDraft,
  timeZone: string,
): Partial<ActivityUpdateInput> {
  const bounds = eventBounds(d, timeZone, stored);
  if (!bounds.startChanged && !bounds.endChanged) return {};
  const { temporal, start, end } = bounds;
  const duration =
    start !== null && end !== null ? (Date.parse(end) - Date.parse(start)) / 60_000 : 0;
  return {
    ...(bounds.startChanged
      ? { dueAt: temporal.dueAt, allDay: temporal.allDay, dueDate: temporal.dueDate }
      : {}),
    ...(bounds.endChanged ? { endAt: end, endDate: temporal.endDate } : {}),
    // The legacy duration column stores whole minutes. Explicit endAt retains the exact
    // chosen endpoint; do not round or reconstruct an untouched start to fit this column.
    durationMinutes: temporal.allDay
      ? temporal.durationMinutes
      : duration > 0
        ? Math.ceil(duration)
        : null,
  };
}

export function moveCalendarStart(
  d: ActivityDraft,
  next: { date: string; time: string },
  timeZone: string,
  stored?: EditableActivity,
): ActivityDraft {
  const moved = { ...d, startDate: next.date, startTime: next.time };
  try {
    if (d.startTime === "" && next.time === "") {
      const days = Temporal.PlainDate.from(d.startDate).until(
        Temporal.PlainDate.from(d.endDate || d.startDate),
      ).days;
      return { ...moved, endDate: addCivilDays(next.date, Math.max(0, days)) };
    }
    if (d.startTime === "" || next.time === "" || d.endTime === "") return moved;
    const previous = eventBounds(d, timeZone, stored);
    if (previous.start === null || previous.end === null) return moved;
    const duration =
      Math.ceil((Date.parse(previous.end) - Date.parse(previous.start)) / 60_000) * 60_000;
    if (duration <= 0) return moved;
    const start = wallTimeToInstant(next.date, next.time, timeZone);
    const end = instantParts(Date.parse(start.iso) + duration, timeZone);
    return { ...moved, endDate: end.date, endTime: end.time };
  } catch {
    return moved;
  }
}

// Compare against the form projection before converting dates. Opening/saving an event must
// preserve exact instants, an ambiguous-hour offset, private relationships and unseen fields.
export function calendarEventPatch(
  stored: EditableActivity,
  d: ActivityDraft,
  timeZone: string,
): ActivityUpdateInput | null {
  const initial = calendarEventDraft({ editing: stored, timeZone });
  const patch: ActivityUpdateInput = { id: stored.id };
  if (d.subject.trim() !== initial.subject) patch.subject = d.subject.trim();
  if (d.typeId !== initial.typeId) patch.typeId = d.typeId;
  if (d.priority !== initial.priority) patch.priority = d.priority === "" ? null : d.priority;
  if (d.location.trim() !== initial.location) patch.location = d.location.trim() || null;
  if (d.note !== initial.note) patch.note = isBlankHtml(d.note) ? null : d.note;
  if (d.videoCallUrl !== initial.videoCallUrl) patch.videoCallUrl = d.videoCallUrl || null;
  if (d.ownerId !== initial.ownerId && d.ownerId !== "") patch.assigneeId = d.ownerId;
  Object.assign(patch, calendarTemporalPatch(stored, d, timeZone));
  return Object.keys(patch).length === 1 ? null : patch;
}
