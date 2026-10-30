import de from "./messages/boundary.de.json";
import en from "./messages/boundary.en.json";
import fa from "./messages/boundary.fa.json";
import { LOCALE_COOKIE } from "./preferences";
import { type Locale, parseLocale } from "./registry";

// A root-layout failure cannot rely on the application provider or its full catalog.
export function emergencyLocale(cookie: string): Locale {
  const value = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1);
  try {
    return parseLocale(value === undefined ? undefined : decodeURIComponent(value));
  } catch {
    return "en";
  }
}

export function emergencyMessages(locale: Locale) {
  return { en, fa, de }[locale];
}
