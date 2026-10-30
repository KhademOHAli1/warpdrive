import { createTranslator, type NamespaceKeys, type NestedKeyOf } from "use-intl/core";
import tableGerman from "@/components/data-table/messages/tableControls.de.json";
import tableEnglish from "@/components/data-table/messages/tableControls.en.json";
import tablePersian from "@/components/data-table/messages/tableControls.fa.json";
import filtersGerman from "@/components/filters/messages/filters.de.json";
import filtersEnglish from "@/components/filters/messages/filters.en.json";
import filtersPersian from "@/components/filters/messages/filters.fa.json";
import shellGerman from "@/components/shell/messages/shell.de.json";
import shellEnglish from "@/components/shell/messages/shell.en.json";
import shellPersian from "@/components/shell/messages/shell.fa.json";
import utilitiesGerman from "@/components/shell/messages/utilities.de.json";
import utilitiesEnglish from "@/components/shell/messages/utilities.en.json";
import utilitiesPersian from "@/components/shell/messages/utilities.fa.json";
import sharedGerman from "@/components/ui/messages/shared.de.json";
import sharedEnglish from "@/components/ui/messages/shared.en.json";
import sharedPersian from "@/components/ui/messages/shared.fa.json";
import { CALENDAR_MESSAGES } from "@/features/activities/calendarMessages";
import activitiesGerman from "@/features/activities/messages/activities.de.json";
import activitiesEnglish from "@/features/activities/messages/activities.en.json";
import activitiesPersian from "@/features/activities/messages/activities.fa.json";
import authGerman from "@/features/auth/messages/authScreens.de.json";
import authEnglish from "@/features/auth/messages/authScreens.en.json";
import authPersian from "@/features/auth/messages/authScreens.fa.json";
import contactsGerman from "@/features/contacts/messages/contacts.de.json";
import contactsEnglish from "@/features/contacts/messages/contacts.en.json";
import contactsPersian from "@/features/contacts/messages/contacts.fa.json";
import customGerman from "@/features/custom-fields/messages/customFields.de.json";
import customEnglish from "@/features/custom-fields/messages/customFields.en.json";
import customPersian from "@/features/custom-fields/messages/customFields.fa.json";
import salesGerman from "@/features/deals/messages/sales.de.json";
import salesEnglish from "@/features/deals/messages/sales.en.json";
import salesPersian from "@/features/deals/messages/sales.fa.json";
import emailGerman from "@/features/email/messages/email.de.json";
import emailEnglish from "@/features/email/messages/email.en.json";
import emailPersian from "@/features/email/messages/email.fa.json";
import enrichmentGerman from "@/features/enrichment/messages/enrichment.de.json";
import enrichmentEnglish from "@/features/enrichment/messages/enrichment.en.json";
import enrichmentPersian from "@/features/enrichment/messages/enrichment.fa.json";
import entityGerman from "@/features/entity-create/messages/entityCreate.de.json";
import entityEnglish from "@/features/entity-create/messages/entityCreate.en.json";
import entityPersian from "@/features/entity-create/messages/entityCreate.fa.json";
import filesGerman from "@/features/files/messages/files.de.json";
import filesEnglish from "@/features/files/messages/files.en.json";
import filesPersian from "@/features/files/messages/files.fa.json";
import settingsGerman from "@/features/identity/messages/settings.de.json";
import settingsEnglish from "@/features/identity/messages/settings.en.json";
import settingsPersian from "@/features/identity/messages/settings.fa.json";
import leadsGerman from "@/features/leads/messages/leads.de.json";
import leadsEnglish from "@/features/leads/messages/leads.en.json";
import leadsPersian from "@/features/leads/messages/leads.fa.json";
import notificationsGerman from "@/features/notifications/messages/notifications.de.json";
import notificationsEnglish from "@/features/notifications/messages/notifications.en.json";
import notificationsPersian from "@/features/notifications/messages/notifications.fa.json";
import quickGerman from "@/features/quick-add/messages/quickAdd.de.json";
import quickEnglish from "@/features/quick-add/messages/quickAdd.en.json";
import quickPersian from "@/features/quick-add/messages/quickAdd.fa.json";
import statsGerman from "@/features/stats/messages/stats.de.json";
import statsEnglish from "@/features/stats/messages/stats.en.json";
import statsPersian from "@/features/stats/messages/stats.fa.json";
import { localeWithNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";
import { mergeMessages } from "./mergeMessages";
import boundaryGerman from "./messages/boundary.de.json";
import boundaryEnglish from "./messages/boundary.en.json";
import boundaryPersian from "./messages/boundary.fa.json";
import de from "./messages/de.json";
import en from "./messages/en.json";
import fa from "./messages/fa.json";
import type { Locale } from "./registry";

const english = {
  ...en,
  utilities: utilitiesEnglish,
  enrichment: enrichmentEnglish,
  stats: statsEnglish,
  authScreens: authEnglish,
  customFields: customEnglish,
  files: filesEnglish,
  email: emailEnglish,
  quickAdd: quickEnglish,
  boundaries: boundaryEnglish,
  calendar: CALENDAR_MESSAGES.en,
  activities: activitiesEnglish,
  sharedUi: sharedEnglish,
  shell: shellEnglish,
  settings: settingsEnglish,
  contacts: contactsEnglish,
  leads: leadsEnglish,
  entityCreate: entityEnglish,
  sales: salesEnglish,
  filters: filtersEnglish,
  tableControls: tableEnglish,
  notifications: notificationsEnglish,
};
const persian: typeof english = mergeMessages(english, {
  ...fa,
  utilities: utilitiesPersian,
  enrichment: enrichmentPersian,
  stats: statsPersian,
  authScreens: authPersian,
  customFields: customPersian,
  files: filesPersian,
  email: emailPersian,
  quickAdd: quickPersian,
  boundaries: boundaryPersian,
  calendar: CALENDAR_MESSAGES.fa,
  activities: activitiesPersian,
  sharedUi: sharedPersian,
  shell: shellPersian,
  settings: settingsPersian,
  contacts: contactsPersian,
  leads: leadsPersian,
  entityCreate: entityPersian,
  sales: salesPersian,
  filters: filtersPersian,
  tableControls: tablePersian,
  notifications: notificationsPersian,
});
const german: typeof english = mergeMessages(english, {
  ...de,
  utilities: utilitiesGerman,
  enrichment: enrichmentGerman,
  stats: statsGerman,
  authScreens: authGerman,
  customFields: customGerman,
  files: filesGerman,
  email: emailGerman,
  quickAdd: quickGerman,
  boundaries: boundaryGerman,
  calendar: CALENDAR_MESSAGES.de,
  activities: activitiesGerman,
  sharedUi: sharedGerman,
  shell: shellGerman,
  settings: settingsGerman,
  contacts: contactsGerman,
  leads: leadsGerman,
  entityCreate: entityGerman,
  sales: salesGerman,
  filters: filtersGerman,
  tableControls: tableGerman,
  notifications: notificationsGerman,
});
const catalogs = { en: english, fa: persian, de: german } satisfies Record<Locale, typeof english>;
export type AppMessages = typeof english;
export type AppNamespace = NamespaceKeys<AppMessages, NestedKeyOf<AppMessages>>;

export function messagesForLocale(locale: Locale): AppMessages {
  return catalogs[locale];
}

export function createAppTranslator<Namespace extends AppNamespace>(
  locale: Locale,
  namespace: Namespace,
  numberingSystem?: NumberingSystem,
) {
  return createTranslator({
    locale: localeWithNumberingSystem(locale, numberingSystem),
    messages: messagesForLocale(locale),
    namespace,
  });
}
