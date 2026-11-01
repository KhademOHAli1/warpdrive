import type { CustomFieldDef } from "@/types/customFields";
import type { MappedRow } from "@/types/import";
import { err, ok, type Result } from "@/types/result";
import {
  hasImportDateOptions,
  type ImportDateOptions,
  parseImportCivilDate,
  parseRegionalImportDate,
} from "./importDateConventions";
import type { ImportTarget } from "./wizardState";

interface DateIssue {
  field: string;
  message: string;
}
const MESSAGES = {
  invalid_date: "must be a valid date",
  ambiguous_time: "ambiguous local time; include an explicit UTC offset",
  nonexistent_time: "local time does not exist in the selected time zone",
} as const;
const INSTANT_FIELDS = ["dueAt", "createdAt", "wonTime", "lostTime", "doneAt"];
function civil(
  value: unknown,
  field: string,
  options: ImportDateOptions,
  errors: DateIssue[],
): unknown {
  if (typeof value !== "string" || value.trim() === "") return value;
  const date = parseImportCivilDate(value, options.dateCalendar ?? "gregory");
  if (date === null) errors.push({ field, message: MESSAGES.invalid_date });
  return date ?? value;
}
function normalizeInstants(
  primary: Record<string, unknown>,
  target: ImportTarget,
  options: ImportDateOptions,
  errors: DateIssue[],
) {
  for (const key of INSTANT_FIELDS) {
    const raw = primary[key];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const parsed = parseRegionalImportDate(raw, options);
    if (!parsed.ok) {
      errors.push({ field: key, message: MESSAGES[parsed.error] });
      continue;
    }
    primary[key] = parsed.value.iso;
    if (target === "activity" && key === "dueAt") {
      primary.allDay = parsed.value.dateOnly;
      primary.dueDate = parsed.value.dateOnly ? parsed.value.civilDate : null;
    }
  }
}
function customDates(
  value: unknown,
  defs: readonly CustomFieldDef[],
  options: ImportDateOptions,
  errors: DateIssue[],
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const custom = { ...value } as Record<string, unknown>;
  for (const def of defs) {
    const raw = custom[def.key];
    if (raw === undefined) continue;
    if (def.type === "date")
      custom[def.key] = civil(raw, `customFields.${def.key}`, options, errors);
    if (def.type === "date_range" && typeof raw === "object" && raw !== null) {
      const range = raw as Record<string, unknown>;
      custom[def.key] = {
        start: civil(range.start, `customFields.${def.key}.start`, options, errors),
        end: civil(range.end, `customFields.${def.key}.end`, options, errors),
      };
    }
  }
  return custom;
}

// CSV originals remain in row.raw; only the validated mapped projection receives
// Gregorian civil dates and UTC instants before the existing canonical schemas.
export function normalizeImportDates(
  target: ImportTarget,
  mapped: MappedRow,
  defs: readonly CustomFieldDef[],
  options: ImportDateOptions,
): Result<MappedRow, DateIssue[]> {
  if (!hasImportDateOptions(options)) return ok(mapped);
  const primary = { ...mapped.primary };
  const errors: DateIssue[] = [];
  normalizeInstants(primary, target, options, errors);
  if (primary.expectedCloseDate !== undefined)
    primary.expectedCloseDate = civil(
      primary.expectedCloseDate,
      "expectedCloseDate",
      options,
      errors,
    );
  if (primary.customFields !== undefined)
    primary.customFields = customDates(primary.customFields, defs, options, errors);
  return errors.length > 0 ? err(errors) : ok({ ...mapped, primary });
}
