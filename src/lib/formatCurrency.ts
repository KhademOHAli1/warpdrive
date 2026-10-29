/// <reference lib="es2023.intl" />
import { type FormattingPreferences, localeTagForFormatting } from "./localeFormatting";

// Currency is business data, independent of interface language. Stored decimal values
// remain canonical; only their display digits, separators and symbol placement change.
export function formatCurrency(
  value: string | number,
  currency = "USD",
  preferences: Partial<FormattingPreferences> = {},
): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  // Intl formats decimal strings exactly; converting a large total to Number loses its fraction.
  return new Intl.NumberFormat(localeTagForFormatting(preferences), {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(typeof value === "string" ? (value as Intl.StringNumericLiteral) : value);
}
