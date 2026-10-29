export const NUMBERING_SYSTEMS = ["arabext", "latn"] as const;
export type NumberingSystem = (typeof NUMBERING_SYSTEMS)[number];
export type NumberedLocale<Locale extends string> = Locale | `${Locale}-u-nu-${NumberingSystem}`;

export function displayNumberingSystem({
  locale = "en",
  numberingSystem,
}: {
  locale?: string;
  numberingSystem?: NumberingSystem;
}): NumberingSystem {
  return locale.startsWith("fa") ? (numberingSystem ?? "arabext") : "latn";
}

export function localeWithNumberingSystem<Locale extends "en" | "fa" | "de">(
  locale: Locale,
  numberingSystem?: NumberingSystem,
): NumberedLocale<Locale>;
export function localeWithNumberingSystem(
  locale: string,
  numberingSystem?: NumberingSystem,
): string;
export function localeWithNumberingSystem(
  locale: string,
  numberingSystem?: NumberingSystem,
): string {
  return numberingSystem === undefined
    ? locale
    : new Intl.Locale(locale, {
        numberingSystem: displayNumberingSystem({ locale, numberingSystem }),
      }).toString();
}
