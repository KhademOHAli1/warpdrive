import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import type { FormattingLocale } from "@/lib/localeFormatting";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";

export const scalarLiteralTypes = ["number", "date", "instant"] as const;
export type ScalarLiteralType = (typeof scalarLiteralTypes)[number];
export interface ScalarLiteralDraft {
  kind: "value";
  value: string | number | boolean | null;
  literalType?: ScalarLiteralType;
}
export type LiteralIntentIssue =
  | "literal_number_invalid"
  | "literal_date_invalid"
  | "literal_instant_invalid";

export function isMappingDate(value: unknown): value is string {
  return z.string().date().safeParse(value).success;
}

export function isMappingInstant(value: unknown): value is string {
  if (!z.string().datetime({ offset: true }).safeParse(value).success || typeof value !== "string")
    return false;
  try {
    Temporal.Instant.from(value);
    return true;
  } catch {
    return false;
  }
}

export function validateLiteralIntent(literal: ScalarLiteralDraft): LiteralIntentIssue | null {
  if (literal.literalType === "number")
    return typeof literal.value === "number" && Number.isFinite(literal.value)
      ? null
      : "literal_number_invalid";
  if (literal.literalType === "date")
    return isMappingDate(literal.value) ? null : "literal_date_invalid";
  if (literal.literalType === "instant")
    return isMappingInstant(literal.value) ? null : "literal_instant_invalid";
  return typeof literal.value === "number" && !Number.isFinite(literal.value)
    ? "literal_number_invalid"
    : null;
}

export function numericLiteralFromInput(raw: string, locale: FormattingLocale): ScalarLiteralDraft {
  const normalized = normalizeNumberInput(raw, locale);
  if (normalized !== null && !normalized.endsWith(".")) {
    const value = Number(normalized);
    if (Number.isFinite(value)) return { kind: "value", value };
  }
  return { kind: "value", value: raw, literalType: "number" };
}

export function typedLiteralFromInput(type: "date" | "instant", raw: string): ScalarLiteralDraft {
  return { kind: "value", value: raw, literalType: type };
}
