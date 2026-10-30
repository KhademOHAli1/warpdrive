import type { FormattingLocale } from "@/lib/localeFormatting";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";

// Saved numeric strings are canonical. Only authored number drafts carry a parsing locale;
// retaining it prevents a language switch from changing the meaning of an unfinished draft.
export interface NumberDraft {
  kind: "number-draft";
  raw: string;
  locale: FormattingLocale;
}
export type RowValue = string | string[] | NumberDraft;

export function isNumberDraft(value: RowValue): value is NumberDraft {
  return typeof value === "object" && !Array.isArray(value);
}

export function invalidNumberDraft(value: RowValue): boolean {
  return (
    isNumberDraft(value) &&
    value.raw.trim() !== "" &&
    normalizeNumberInput(value.raw, value.locale) === null
  );
}

// The value a completed row carries, or null when the row is still incomplete. A blank text box
// and an empty multi-select both mean "nothing chosen", and a condition built from either would
// match nothing while the filter looked applied.
export function completeRowValue(value: RowValue): string | string[] | null {
  if (Array.isArray(value)) {
    const picked = value.map((v) => v.trim()).filter((v) => v !== "");
    return picked.length === 0 ? null : picked;
  }
  if (isNumberDraft(value)) {
    const raw = value.raw.trim();
    return raw === "" ? null : normalizeNumberInput(raw, value.locale);
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// The row value as a single string, for the controls and checks that only handle one.
export function singleRowValue(value: RowValue): string {
  if (isNumberDraft(value)) return value.raw;
  return Array.isArray(value) ? (value[0] ?? "") : value;
}

// A stored condition value back in row form, so an applied filter reopens as editable rows. A
// valueless op (isEmpty / isNotEmpty) carries no value and reopens with a blank box.
export function rowValueOf(value: string | number | readonly string[] | undefined): RowValue {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return [...value];
}

// The row value as a list, for the multi-select. A blank single value is "nothing picked".
export function rowValueList(value: RowValue): string[] {
  if (Array.isArray(value)) return value;
  const single = singleRowValue(value);
  return single === "" ? [] : [single];
}
