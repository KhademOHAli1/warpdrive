/// <reference lib="es2023.intl" />
import { type FormattingPreferences, localeTagForFormatting } from "./localeFormatting";

export type IranianMoneyUnit = "rial" | "toman";
// Canonical amounts have at most four decimal places. Decimal-point movement
// preserves the fifth toman decimal and never converts through binary floats.
export function irrToToman(value: string | number): string | null {
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const matched = /^([+-]?)(\d{1,100})(?:\.(\d{1,4}))?$/.exec(String(value));
  if (matched === null) return null;
  const whole = (matched[2] ?? "0").replace(/^0+(?=\d)/, "");
  const fraction = `${whole.slice(-1)}${matched[3] ?? ""}`.replace(/0+$/, "");
  const integer = whole.length > 1 ? whole.slice(0, -1) : "0";
  const sign = matched[1] === "-" && (integer !== "0" || fraction !== "") ? "-" : "";
  return `${sign}${integer}${fraction === "" ? "" : `.${fraction}`}`;
}

export function formatToman(
  value: string | number,
  preferences: Partial<FormattingPreferences>,
): string {
  const decimal = irrToToman(value);
  if (decimal === null) return "";
  const amount = new Intl.NumberFormat(localeTagForFormatting(preferences), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 5,
  }).format(decimal as Intl.StringNumericLiteral);
  const label =
    preferences.locale === "fa" ? "تومان" : preferences.locale === "de" ? "Toman" : "toman";
  return `${amount}\u00a0${label}`;
}
