import { useState } from "react";
import type { FormattingLocale } from "@/lib/localeFormatting";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";

export function customTextValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function customNumberDraft(
  raw: string,
  locale: FormattingLocale,
  monetary = false,
): string | number | undefined {
  if (raw.trim() === "") return undefined;
  const normalized = normalizeNumberInput(raw, locale);
  if (normalized === null || normalized.endsWith(".")) return raw;
  const fraction = normalized.split(".")[1]?.replace(/0+$/, "") ?? "";
  // Check authored precision before Number can erase an overprecise fractional tail.
  if (monetary && fraction.length > 2) return raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : raw;
}

export function useNumberEditingDraft(value: unknown, locale: FormattingLocale, formatted: string) {
  const [draft, setDraft] = useState<{
    value: unknown;
    locale: FormattingLocale;
    raw: string;
  } | null>(null);
  const current = draft !== null && Object.is(draft.value, value) && draft.locale === locale;
  if (draft !== null && !current) setDraft(null);
  return {
    text: current ? draft.raw : formatted,
    capture: (raw: string, next: unknown) => setDraft({ value: next, locale, raw }),
    finish: () => setDraft(null),
  };
}

export function customObjectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

export function customObjectPatch(value: unknown, key: string, next: unknown): unknown {
  const result = customObjectValue(value);
  if (next === undefined) delete result[key];
  else result[key] = next;
  return Object.keys(result).length === 0 ? undefined : result;
}
