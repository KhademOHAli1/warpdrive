import type { FormattingLocaleTag } from "@/lib/localeFormatting";

function asciiDigit(character: string): string {
  const code = character.charCodeAt(0);
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  return character;
}

export function normalizeDigits(raw: string): string {
  return raw.replace(/[۰-۹٠-٩]/g, asciiDigit);
}

interface NumberSeparators {
  decimal: string;
  group: string;
  primaryGroup: number;
  secondaryGroup: number;
}

function numberSeparators(locale: FormattingLocaleTag): NumberSeparators | null {
  if (locale === "en" || locale === "de" || locale === "fa") {
    return {
      decimal: locale === "de" ? "," : ".",
      group: locale === "de" ? "." : ",",
      primaryGroup: 3,
      secondaryGroup: 3,
    };
  }
  try {
    // Latin punctuation follows the region. Arabic punctuation is accepted separately,
    // so either keyboard works even when the display uses Persian numerals.
    const parts = new Intl.NumberFormat(locale, { numberingSystem: "latn" }).formatToParts(
      123456789.5,
    );
    const widths = parts.filter((part) => part.type === "integer").map((part) => part.value.length);
    const primaryGroup = widths.at(-1) ?? 3;
    return {
      decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
      group: parts.find((part) => part.type === "group")?.value ?? ",",
      primaryGroup,
      secondaryGroup: widths.at(-2) ?? primaryGroup,
    };
  } catch {
    return null;
  }
}

function validGrouping(canonical: string, { primaryGroup, secondaryGroup }: NumberSeparators) {
  const integer = canonical.replace(/^[+-]/u, "").split(".")[0] ?? "";
  const groups = integer.split(",");
  if (groups.length === 1) return true;
  const first = groups[0]?.length ?? 0;
  return (
    first > 0 &&
    first <= secondaryGroup &&
    groups.at(-1)?.length === primaryGroup &&
    groups.slice(1, -1).every((group) => group.length === secondaryGroup)
  );
}

// This is a user-input boundary. Stored decimal strings must never pass through this
// locale-dependent parser because the same dot can mean a group or a decimal.
export function normalizeNumberInput(
  raw: string,
  locale: FormattingLocaleTag = "en",
): string | null {
  const input = normalizeDigits(raw.trim()).replaceAll("−", "-");
  if (input === "") return null;
  const separators = numberSeparators(locale);
  if (separators === null) return null;
  const decimals = new Set([separators.decimal, "٫"]);
  const groups = new Set([separators.group, "٬"]);
  if (separators.group === "’" || separators.group === "'") {
    groups.add("’");
    groups.add("'");
  }
  const authored = locale.includes("-") ? input.replace(/^[\u061c\u200e\u200f]+/u, "") : input;
  if ([...groups].filter((group) => authored.includes(group)).length > 1) return null;
  if ([...decimals].filter((decimal) => authored.includes(decimal)).length > 1) return null;
  let canonical = "";
  for (const character of authored) {
    if (decimals.has(character)) canonical += ".";
    else if (groups.has(character)) canonical += ",";
    else if (character === "." || character === ",") return null;
    else canonical += character;
  }
  if (!/^[+-]?(?:\d[\d,]*(?:\.\d*)?|\.\d+)$/u.test(canonical)) return null;
  if (!validGrouping(canonical, separators)) return null;
  return canonical.replaceAll(",", "");
}
