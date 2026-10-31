import { managementMessagesForLocale } from "@/features/auth/management/messages";
import { getLocalePreferences } from "@/features/i18n/server";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { SecurityAdminClient } from "./SecurityAdminClient";
export async function generateMetadata() {
  const preferences = await getLocalePreferences();
  return { title: managementMessagesForLocale(preferences.locale).title };
}
export default async function SecurityAdminPage() {
  const preferences = await getLocalePreferences();
  const L = managementMessagesForLocale(preferences.locale);
  const { actor } = await createContext();
  if (actor === null || (actor.type !== "admin" && !actor.flags.has("permissions.manage")))
    return <p className="text-sm text-destructive">{L.forbidden}</p>;
  return (
    <SettingsPage className="max-w-5xl">
      <SettingsHeading scope="workspace" title={L.title} description={L.description} />
      <SecurityAdminClient />
    </SettingsPage>
  );
}
