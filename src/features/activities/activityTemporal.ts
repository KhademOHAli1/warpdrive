import { instantCivilDate, instantParts, type ZonedInstant } from "@/lib/zonedDateTime";

export {
  addCivilDays,
  civilDateRange,
  instantCivilDate,
  instantParts,
  wallTimeToInstant,
} from "@/lib/zonedDateTime";
export type ActivityInstant = ZonedInstant;
export interface ActivityTemporalRecord {
  dueAt?: ActivityInstant | null;
  dueAtIso?: string | null;
  endAt?: ActivityInstant | null;
  allDay: boolean;
  dueDate?: string | null;
  endDate?: string | null;
}
export function activityDay(a: ActivityTemporalRecord, timeZone = "UTC"): string | null {
  if (a.allDay && a.dueDate) return a.dueDate;
  const at = a.dueAt ?? a.dueAtIso;
  return at == null ? null : instantCivilDate(at, timeZone);
}
export function activityEndDay(a: ActivityTemporalRecord, timeZone = "UTC"): string | null {
  if (a.allDay && a.dueDate) return a.endDate ?? a.dueDate;
  return a.endAt == null ? activityDay(a, timeZone) : instantCivilDate(a.endAt, timeZone);
}
// Legacy all-day timestamps have no recoverable original zone. This explicit compatibility
// projection uses the account zone and exposes uncertainty; it never backfills a civil date.
export function activityParts(a: ActivityTemporalRecord, timeZone = "UTC") {
  const date = activityDay(a, timeZone) ?? "";
  const at = a.dueAt ?? a.dueAtIso;
  return {
    date,
    time: a.allDay || at == null ? "" : instantParts(at, timeZone).time,
    legacy: a.allDay && at != null && !a.dueDate,
  };
}
