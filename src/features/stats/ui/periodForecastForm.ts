import type { FormattingLocaleTag } from "@/lib/localeFormatting";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";

type ForecastField = "probability" | "size";

/** Returns null for an omitted factor and undefined for invalid authored input. */
export function readForecastFactor(
  authored: string,
  locale: FormattingLocaleTag,
  field: ForecastField,
): string | null | undefined {
  if (authored.trim() === "") return null;
  const value = normalizeNumberInput(authored, locale);
  if (value === null || !/^\+?(?:\d{1,3}(?:\.\d*)?|\.\d+)$/u.test(value)) return undefined;
  const [whole = "", fraction = ""] = value.replace(/^\+/u, "").split(".");
  const probability = field === "probability";
  const places = probability ? 4 : 6;
  if (fraction.length > places) return undefined;
  const units = BigInt(whole || "0") * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, "0"));
  if (units > (probability ? 1_000_000n : 10_000_000n)) return undefined;
  const integer = units / 1_000_000n;
  const tail = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return tail === "" ? String(integer) : `${integer}.${tail}`;
}
