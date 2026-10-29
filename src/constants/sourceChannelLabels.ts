import { messagesForLocale } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
import { SOURCE_CHANNEL_KEYS, type SourceChannelKey } from "./sourceChannels";

// Keys are stable persisted values. Only their presentation depends on the viewer's language.
export function sourceChannelLabel(key: SourceChannelKey, locale: Locale = "en"): string {
  return messagesForLocale(locale).sales.sourceChannels[key];
}
export function sourceChannelOptions(
  locale: Locale = "en",
): Array<{ value: SourceChannelKey; label: string }> {
  return SOURCE_CHANNEL_KEYS.map((value) => ({ value, label: sourceChannelLabel(value, locale) }));
}
