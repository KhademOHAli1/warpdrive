/// <reference lib="es2023.intl" />
import { type FormattingPreferences, localeTagForFormatting } from "./localeFormatting";

export type IranianMoneyUnit = "rial" | "toman";

// Finite Number literals bound this expansion; their shortest decimal form can
// contain an exponent even though legacy numeric custom fields accept the value.
function expandNumericDecimal(value: number): string {
  const text = String(value);
  const separator = text.indexOf("e");
  if (separator === -1) return text;
  const negative = text.startsWith("-");
  const coefficient = text.slice(negative ? 1 : 0, separator);
  const point = coefficient.indexOf(".");
  const digits = coefficient.replace(".", "");
  const position = (point === -1 ? coefficient.length : point) + Number(text.slice(separator + 1));
  const expanded =
    position <= 0
      ? `0.${"0".repeat(-position)}${digits}`
      : position >= digits.length
        ? `${digits}${"0".repeat(position - digits.length)}`
        : `${digits.slice(0, position)}.${digits.slice(position)}`;
  return `${negative ? "-" : ""}${expanded}`;
}

// Decimal strings retain their bounded four-place contract. Numeric values keep
// the legacy finite-number domain; moving the point never divides binary floats.
export function irrToToman(value: string | number): string | null {
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const text = typeof value === "number" ? expandNumericDecimal(value) : value;
  const pattern =
    typeof value === "number"
      ? /^([+-]?)(\d+)(?:\.(\d+))?$/
      : /^([+-]?)(\d{1,100})(?:\.(\d{1,4}))?$/;
  const matched = pattern.exec(text);
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
