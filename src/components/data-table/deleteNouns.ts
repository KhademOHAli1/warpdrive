import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";

// Existing callers provide labels. Translate only the recognized built-in English pairs;
// custom domain labels keep their exact spelling and the singular/plural choice supplied.
const BUILT_IN_PAIRS = {
  "person:people": "person",
  "organization:organizations": "organization",
  "lead:leads": "lead",
  "deal:deals": "deal",
  "activity:activities": "activity",
  "email:emails": "email",
  "record:records": "record",
  "item:items": "item",
} as const;
export function deleteNouns(noun: string, nounPlural: string, count: number, locale: Locale) {
  const pair = `${noun}:${nounPlural}`;
  if (locale === "en" || !Object.hasOwn(BUILT_IN_PAIRS, pair))
    return { unit: count === 1 ? noun : nounPlural, plural: nounPlural };
  const kind = BUILT_IN_PAIRS[pair as keyof typeof BUILT_IN_PAIRS];
  const t = createAppTranslator(locale, "tableControls");
  return { unit: t(`nouns.${kind}.singular`), plural: t(`nouns.${kind}.plural`) };
}
