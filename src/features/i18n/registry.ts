export const LOCALE_REGISTRY = {
  en: { name: "English", direction: "ltr", status: "available", defaultCalendar: "gregory" },
  fa: { name: "فارسی", direction: "rtl", status: "available", defaultCalendar: "persian" },
  de: { name: "Deutsch", direction: "ltr", status: "available", defaultCalendar: "gregory" },
} as const;

export const SELECTABLE_LOCALES = ["en", "fa", "de"] as const;
export type Locale = (typeof SELECTABLE_LOCALES)[number];
export type PlannedLocale = keyof typeof LOCALE_REGISTRY;

export function parseLocale(value: string | undefined): Locale {
  return SELECTABLE_LOCALES.find((locale) => locale === value) ?? "en";
}

export function directionForLocale(locale: Locale): "ltr" | "rtl" {
  return LOCALE_REGISTRY[locale].direction;
}
