// Custom-field display is a read boundary. Persisted keys, dates, amounts and option labels are
// preserved; UI callers supply explicit preferences while legacy exports keep their raw defaults.
import { DEFAULT_BASE_CURRENCY } from "@/constants/currency";
import { createAppTranslator } from "@/features/i18n/catalog";
import { parseLocale } from "@/features/i18n/registry";
import { formatCurrency } from "@/lib/formatCurrency";
import { type FormattingPreferences, formatDateOnly, formatNumber } from "@/lib/localeFormatting";
import type { CustomFieldDef } from "@/types/customFields";
import { assertNever } from "@/types/result";
import type { CustomFieldRefLabels } from "./refLabelsShared";
import { isCustomFieldValueEmpty } from "./valueEmpty";

export { CustomFieldDetail, CustomFieldFormControl } from "./render.widgets";
export type { CustomFieldDef };
export { isCustomFieldValueEmpty };

export function formatCustomFieldDisplay(
  def: CustomFieldDef,
  value: unknown,
  currency = DEFAULT_BASE_CURRENCY,
  refLabels?: CustomFieldRefLabels,
  preferences?: Partial<FormattingPreferences>,
): string {
  const t = createAppTranslator(parseLocale(preferences?.locale), "customFields");
  if (isCustomFieldValueEmpty(value)) return t("empty");
  const listSeparator = preferences?.locale === "fa" ? "، " : ", ";
  const optionLabel = (id: string) => def.options.find((option) => option.id === id)?.label ?? id;
  const date = (raw: string) =>
    preferences === undefined ? raw : formatDateOnly(raw, preferences) || raw;
  const time = (raw: string) =>
    preferences === undefined
      ? raw
      : raw.replace(/\d/g, (digit) =>
          formatNumber(Number(digit), preferences, { useGrouping: false }),
        );
  switch (def.type) {
    case "text":
    case "large_text":
    case "autocomplete":
    case "phone":
      return value as string;
    case "date":
      return date(value as string);
    case "time":
      return time(value as string);
    case "numeric":
      return preferences === undefined || typeof value !== "number"
        ? String(value)
        : formatNumber(value, preferences, { maximumFractionDigits: 20 });
    case "monetary":
      return formatCurrency(value as number, currency, preferences);
    case "single_option":
      return optionLabel(value as string);
    case "multi_option":
      return (value as string[]).map(optionLabel).join(listSeparator);
    case "date_range":
    case "time_range": {
      const range = value as { start: string; end: string };
      const part = def.type === "date_range" ? date : time;
      return t("range", { start: part(range.start), end: part(range.end) });
    }
    case "user":
    case "person":
    case "org": {
      const id = value as string;
      if (refLabels === undefined) return id;
      const bucket =
        def.type === "user"
          ? refLabels.user
          : def.type === "person"
            ? refLabels.person
            : refLabels.org;
      return bucket[id] ?? t("restricted");
    }
    case "address": {
      const address = value as Record<string, string>;
      return [address.street, address.city, address.region, address.postal, address.country]
        .filter(Boolean)
        .join(listSeparator);
    }
    default:
      return assertNever(def.type);
  }
}
