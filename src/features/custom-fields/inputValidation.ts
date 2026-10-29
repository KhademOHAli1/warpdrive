import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
import type { CustomFieldDef } from "@/types/customFields";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import { valueSchemaFor } from "./validate";

export function numericCustomFieldError(
  def: CustomFieldDef,
  value: unknown,
  locale: Locale,
  min?: number,
  max?: number,
): string | null {
  const t = createAppTranslator(locale, "customFields");
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const normalized = normalizeNumberInput(value, locale);
    if (normalized !== null) {
      const contextual = numericCustomFieldError(def, Number(normalized), locale, min, max);
      if (contextual !== null) return contextual;
    }
    return t("numberInvalid", { name: def.name });
  }
  if (typeof value !== "number" || !Number.isFinite(value))
    return t("numberInvalid", { name: def.name });
  if (min !== undefined && value < min) return t("minimum", { name: def.name, min });
  if (max !== undefined && value > max) return t("maximum", { name: def.name, max });
  if (def.type === "monetary" && !valueSchemaFor(def).safeParse(value).success)
    return t("moneyPrecision", { name: def.name });
  return null;
}

// Client feedback mirrors existing field validation. It never coerces stored values or weakens
// the server validator; callers keep administrator-defined names and option IDs unchanged.
export function customFieldDraftError(
  def: CustomFieldDef,
  value: unknown,
  locale: Locale = "en",
): string | null {
  const t = createAppTranslator(locale, "customFields");
  if (
    def.isRequired &&
    (value == null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === "object" &&
        !Array.isArray(value) &&
        Object.values(value).every((entry) => entry == null || entry === "")))
  )
    return t("requiredField", { name: def.name });
  if (def.type === "numeric" || def.type === "monetary") {
    const numeric = numericCustomFieldError(
      def,
      value,
      locale,
      def.type === "monetary" ? 0 : undefined,
    );
    if (numeric !== null) return numeric;
  }
  if (valueSchemaFor(def).safeParse(value).success) return null;
  if (
    (def.type === "date_range" || def.type === "time_range") &&
    typeof value === "object" &&
    value !== null &&
    "start" in value &&
    "end" in value &&
    typeof value.start === "string" &&
    typeof value.end === "string" &&
    value.end < value.start
  )
    return t("rangeOrder");
  if (
    def.type === "address" &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).some((v) => v != null && v !== "") &&
    (!("country" in value) || value.country == null || value.country === "")
  )
    return t("countryRequired");
  return t("valueInvalid", { name: def.name });
}
