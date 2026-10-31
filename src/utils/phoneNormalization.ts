import { type CountryCode, getCountries, parsePhoneNumberWithError } from "libphonenumber-js/max";
import { normalizeDigits } from "./normalizeNumberInput";

export type PhoneCountry = CountryCode;
export const PHONE_COUNTRIES: readonly PhoneCountry[] = getCountries();
const countries = new Set<string>(PHONE_COUNTRIES);
export function isPhoneCountry(value: unknown): value is PhoneCountry {
  return typeof value === "string" && countries.has(value);
}
export interface NormalizedPhone {
  original: string;
  country?: PhoneCountry;
  e164?: string;
  extension?: string;
  status: "valid" | "review";
  reason?: "country_required" | "invalid_number" | "extension";
}

// Region is an explicit data choice, never inferred from language. Metadata
// validation establishes a number's structure, not ownership or reachability.
export function normalizePhoneInput(
  original: string,
  selectedCountry?: PhoneCountry,
): NormalizedPhone {
  const base = { original, ...(selectedCountry === undefined ? {} : { country: selectedCountry }) };
  const input = normalizeDigits(original).trim();
  if (input.length > 256 || (selectedCountry !== undefined && !isPhoneCountry(selectedCountry)))
    return { ...base, status: "review", reason: "invalid_number" };
  if (!input.startsWith("+") && selectedCountry === undefined)
    return { ...base, status: "review", reason: "country_required" };
  try {
    const parsed = parsePhoneNumberWithError(input, {
      defaultCountry: selectedCountry,
      extract: false,
    });
    if (!parsed.isValid()) return { ...base, status: "review", reason: "invalid_number" };
    return {
      ...base,
      e164: parsed.number,
      ...(parsed.ext === undefined ? {} : { extension: parsed.ext }),
      status: parsed.ext === undefined ? "valid" : "review",
      ...(parsed.ext === undefined ? {} : { reason: "extension" as const }),
    };
  } catch {
    return { ...base, status: "review", reason: "invalid_number" };
  }
}
