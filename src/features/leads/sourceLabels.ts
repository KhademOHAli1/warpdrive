import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";

const origins = {
  manually_created: "manuallyCreated",
  imported: "imported",
  web_form: "webFormCapture",
  synced: "synced",
} as const;
export function sourceOriginLabel(key: string, locale: Locale = "en"): string {
  const t = createAppTranslator(locale, "leads");
  return Object.hasOwn(origins, key)
    ? t(origins[key as keyof typeof origins])
    : key.replace(/_/g, " ");
}
