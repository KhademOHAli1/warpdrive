import { instantCivilDate } from "@/lib/zonedDateTime";
import type { ActivityInstant, ActivityTemporalRecord } from "./activityTemporal";

interface TemporalWrite {
  dueAt?: string | null;
  endAt?: string | null;
  allDay?: boolean;
  dueDate?: string | null;
  endDate?: string | null;
}
export function canonicalCreateDates(input: TemporalWrite, zone: string) {
  if (input.allDay !== true || input.dueAt == null || input.dueAt === "")
    return { dueDate: null, endDate: null };
  return {
    dueDate: input.dueDate ?? instantCivilDate(input.dueAt, zone),
    endDate:
      input.endDate ??
      (input.endAt != null && input.endAt !== "" ? instantCivilDate(input.endAt, zone) : null),
  };
}
// A read or unrelated edit cannot resolve the original civil date of an old placeholder instant.
// Only an actual temporal edit establishes canonical dates; no implicit migration on save.
export function canonicalUpdateDates(
  current: ActivityTemporalRecord,
  input: TemporalWrite,
  zone: string,
) {
  const dueAt = input.dueAt === undefined ? current.dueAt : input.dueAt;
  const endAt = input.endAt === undefined ? current.endAt : input.endAt;
  const allDay =
    input.dueAt !== undefined
      ? input.dueAt !== null && (input.allDay ?? false)
      : (input.allDay ?? current.allDay);
  const changed =
    (input.dueAt !== undefined && time(input.dueAt) !== time(current.dueAt)) ||
    (input.endAt !== undefined && time(input.endAt) !== time(current.endAt)) ||
    allDay !== current.allDay ||
    input.dueDate !== undefined ||
    input.endDate !== undefined;
  if (!changed) return {};
  if (!allDay || !hasAnchor(dueAt)) return { dueDate: null, endDate: null };
  return {
    dueDate:
      input.dueDate ??
      (input.dueAt === undefined ? current.dueDate : null) ??
      instantCivilDate(dueAt, zone),
    endDate:
      input.endDate ??
      (input.endAt === undefined ? current.endDate : null) ??
      (hasAnchor(endAt) ? instantCivilDate(endAt, zone) : null),
  };
}
function time(value: Date | string | number | null | undefined) {
  return value == null ? null : new Date(value).getTime();
}
// Keep the legacy presence rule, including empty strings and zero/NaN numeric anchors.
function hasAnchor(value: ActivityInstant | null | undefined): value is ActivityInstant {
  return Boolean(value);
}

export function civilEndBeforeStart(dates: {
  dueDate?: string | null;
  endDate?: string | null;
}): boolean {
  return (
    dates.dueDate != null &&
    dates.dueDate !== "" &&
    dates.endDate != null &&
    dates.endDate !== "" &&
    dates.endDate < dates.dueDate
  );
}
