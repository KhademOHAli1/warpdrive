import { normalizeDigits } from "./normalizeNumberInput";
import { normalizePhoneInput, type PhoneCountry } from "./phoneNormalization";

export function telHref(phone: string, country?: PhoneCountry): string {
  if (country !== undefined) {
    const normalized = normalizePhoneInput(phone, country);
    if (normalized.e164 !== undefined)
      return `tel:${normalized.e164}${normalized.extension === undefined ? "" : `;ext=${normalized.extension}`}`;
  }
  // Dialers want unformatted ASCII digits; preserve the existing plus/extension stripping rules.
  return `tel:${normalizeDigits(phone).replace(/[^\d+]/g, "")}`;
}

// Display-only US phone formatting for the "Convert phone numbers to US format" preference.
// Conservative: only reformats a value whose digits look like a US number (10 digits, or 11 with
// a leading 1). Anything else (international, extensions, too short) is returned untouched so we
// never mangle a number we do not understand. The stored value and tel: href are unaffected.
export function formatUsPhone(raw: string): string {
  let digits = normalizeDigits(raw).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return raw;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
