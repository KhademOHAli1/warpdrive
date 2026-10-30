import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import german from "./messages/activities.de.json";
import english from "./messages/activities.en.json";
import persian from "./messages/activities.fa.json";

const namesByLocale: Record<Locale, MessageCatalog<typeof english.types>> = {
  en: english.types,
  fa: persian.types,
  de: german.types,
};

function isDefaultTypeKey(key: string): key is keyof typeof english.types {
  return Object.hasOwn(english.types, key);
}

export interface ActivityTypeLabel {
  key: string;
  name: string;
  isSystem?: boolean;
}

// These are presentation names at the read boundary, never a migration of stored names.
// Older query projections omit isSystem; seeded keys are unique, so the exact default
// key/name pair identifies those rows while every administrator rename stays untouched.
export function activityTypeName(type: ActivityTypeLabel, locale: Locale): string {
  if (locale === "en" || type.isSystem === false) return type.name;
  const key = type.key;
  if (!isDefaultTypeKey(key) || type.name !== english.types[key]) return type.name;
  return namesByLocale[locale][key];
}

export function localizeActivityTypes<Type extends ActivityTypeLabel>(
  types: readonly Type[],
  locale: Locale,
): Type[] {
  return types.map((type) => ({ ...type, name: activityTypeName(type, locale) }));
}
