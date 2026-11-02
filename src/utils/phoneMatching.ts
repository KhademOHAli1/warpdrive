import { normalizeDigits } from "./normalizeNumberInput";
import { normalizePhoneInput, type PhoneCountry } from "./phoneNormalization";

export type PhoneMatchConfidence = "exact" | "review" | "different";
// A suffix is only a review hint. Only a complete canonical match can support
// downstream identity matching, and multiple exact contacts still require a choice.
export function comparePhoneInputs(
  left: string,
  right: string,
  country?: PhoneCountry,
): PhoneMatchConfidence {
  const a = normalizePhoneInput(left, country);
  const b = normalizePhoneInput(right);
  if (a.status === "valid" && b.status === "valid")
    return a.e164 === b.e164 ? "exact" : "different";
  const rawLeft = normalizeDigits(left).trim();
  const rawRight = normalizeDigits(right).trim();
  const digits = (raw: string) => raw.replace(/\D/g, "");
  const l = digits(rawLeft);
  const r = digits(rawRight);
  if (l.length < 7 || r.length < 7) return "different";
  if (rawLeft.startsWith("+") && rawRight.startsWith("+")) return l === r ? "review" : "different";
  return l.endsWith(r) || r.endsWith(l) ? "review" : "different";
}
