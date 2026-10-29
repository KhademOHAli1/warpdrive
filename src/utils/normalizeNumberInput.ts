import type { FormattingLocale } from "@/lib/localeFormatting";

function asciiDigit(character: string): string {
  const code = character.charCodeAt(0);
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  return character;
}

export function normalizeDigits(raw: string): string {
  return raw.replace(/[۰-۹٠-٩]/g, asciiDigit);
}

// This is a user-input boundary. Stored decimal strings must never pass through this
// locale-dependent parser because German and English interpret a dot differently.
export function normalizeNumberInput(raw: string, locale: FormattingLocale = "en"): string | null {
  const input = normalizeDigits(raw.trim()).replaceAll("−", "-");
  if (input === "") return null;
  const decimal = locale === "de" ? "," : ".";
  const grouping = locale === "de" ? "." : ",";
  if (input.includes(grouping) && input.includes("٬")) return null;
  if (input.includes(decimal) && input.includes("٫")) return null;
  const canonical = Array.from(input, (character) => {
    if (character === decimal || character === "٫") return ".";
    if (character === grouping || character === "٬") return ",";
    return character;
  }).join("");
  if (!/^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)$/.test(canonical)) return null;
  return canonical.replaceAll(",", "");
}
