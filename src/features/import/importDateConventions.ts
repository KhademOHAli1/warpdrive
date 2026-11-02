import { Temporal } from "@js-temporal/polyfill";
import type { CalendarSystem } from "@/lib/localeFormatting";
import {
  addCivilDays,
  civilDateRange,
  instantCivilDate,
  wallTimeToInstant,
} from "@/lib/zonedDateTime";
import { err, ok, type Result } from "@/types/result";
import { normalizeDigits } from "@/utils/normalizeNumberInput";

export const IMPORT_DATE_FIELDS = [
  "expectedCloseDate",
  "dueAt",
  "createdAt",
  "wonTime",
  "lostTime",
  "doneAt",
] as const;
export interface ImportDateOptions {
  dateCalendar?: CalendarSystem;
  dateTimeZone?: string;
}
export type ImportDateFailure = "invalid_date" | "ambiguous_time" | "nonexistent_time";
export function hasImportDateOptions(options: ImportDateOptions = {}): boolean {
  return options.dateCalendar !== undefined || options.dateTimeZone !== undefined;
}
export function parseImportCivilDate(
  value: string,
  calendar: CalendarSystem = "gregory",
): string | null {
  const raw = normalizeDigits(value).trim();
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw);
  const ordered = dotted === null ? raw : `${dotted[3]}-${dotted[2]}-${dotted[1]}`;
  const parts = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(ordered);
  if (parts === null || Number(parts[1]) < 1) return null;
  try {
    const date = Temporal.PlainDate.from(
      { calendar, year: Number(parts[1]), month: Number(parts[2]), day: Number(parts[3]) },
      { overflow: "reject" },
    )
      .withCalendar("iso8601")
      .toString();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  } catch {
    return null;
  }
}

export function parseRegionalImportDate(
  value: string,
  options: ImportDateOptions,
): Result<{ iso: string; civilDate: string; dateOnly: boolean }, ImportDateFailure> {
  const raw = normalizeDigits(value).trim();
  try {
    // Explicit ISO offsets identify Gregorian instants, independent of defaults.
    if (/T.+(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
      const instant = Temporal.Instant.from(raw);
      return ok({
        iso: new Date(instant.epochMilliseconds).toISOString(),
        civilDate: raw.slice(0, 10),
        dateOnly: false,
      });
    }
    const matched =
      /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\.\d{1,2}\.\d{4})(?:[ T](\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?))?$/.exec(
        raw,
      );
    if (matched === null) return err("invalid_date");
    const civilDate = parseImportCivilDate(matched[1] ?? "", options.dateCalendar ?? "gregory");
    if (civilDate === null) return err("invalid_date");
    const zone = options.dateTimeZone ?? "UTC";
    if (matched[2] === undefined) {
      const start = civilDateRange(civilDate, addCivilDays(civilDate, 1), zone).from;
      if (instantCivilDate(start, zone) !== civilDate) return err("invalid_date");
      return ok({ iso: start.toISOString(), civilDate, dateOnly: true });
    }
    const [hour = "00", ...clock] = matched[2].split(":");
    const wall = wallTimeToInstant(civilDate, `${hour.padStart(2, "0")}:${clock.join(":")}`, zone);
    return wall.ambiguous
      ? err("ambiguous_time")
      : ok({ iso: wall.iso, civilDate, dateOnly: false });
  } catch (error) {
    return err(
      error instanceof RangeError && error.message === "nonexistent activity wall time"
        ? "nonexistent_time"
        : "invalid_date",
    );
  }
}
