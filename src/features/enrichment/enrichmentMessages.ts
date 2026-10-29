import { createTranslator } from "use-intl/core";
import type { ENRICHMENT_STRINGS } from "@/constants/enrichmentStrings";
import type { Locale } from "@/features/i18n/registry";
import { localeWithNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";
import argumentsByPath from "./enrichmentMessageParams.json";
import english from "./messages/enrichment.en.json";
import persian from "./messages/enrichment.fa.json";

export { PROVIDER_NAMES, providerName } from "./providerNames";

type Localized<T> = T extends (...args: infer Args) => unknown
  ? (...args: Args) => string
  : T extends string
    ? string
    : { [K in keyof T]: Localized<T[K]> };
export type EnrichmentMessages = Localized<
  Pick<typeof ENRICHMENT_STRINGS, "dialog" | "button" | "outcome" | "prospects">
> &
  Pick<
    typeof english,
    "canonical" | "seniority" | "listSeparator" | "providerError" | "quotaError"
  >;

export function enrichmentMessagesForLocale(
  locale: Locale,
  numberingSystem?: NumberingSystem,
): EnrichmentMessages {
  const translate = createTranslator({
    locale: localeWithNumberingSystem(locale, numberingSystem),
    messages: locale === "fa" ? persian : english,
    formats: { number: { plain: { useGrouping: false } } },
  }) as unknown as (key: string, args?: Record<string, string | number>) => string;
  const params: Record<string, string[]> = argumentsByPath;
  function build(value: unknown, path: string): unknown {
    const names = params[path];
    if (names !== undefined)
      return (...args: (string | number)[]) =>
        translate(
          path,
          Object.fromEntries(
            names.map((name, index) => {
              const value = args[index] ?? "";
              return [
                name,
                locale === "fa" && typeof value === "string" ? `\u2068${value}\u2069` : value,
              ];
            }),
          ),
        );
    if (typeof value === "string") return translate(path);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        build(item, path === "" ? key : `${path}.${key}`),
      ]),
    );
  }
  return build(english, "") as EnrichmentMessages;
}

// Provider payloads and run snapshots keep their canonical keys and original labels. Only the
// reader's display changes. Unknown/custom labels remain authored data; English keeps its label.
export function canonicalFieldLabel(
  key: string,
  fallback: string,
  messages: EnrichmentMessages,
  locale: Locale,
): string {
  const labels: Readonly<Record<string, string>> = messages.canonical;
  return locale === "en" ? fallback : (labels[key.replaceAll(".", "_")] ?? fallback);
}
