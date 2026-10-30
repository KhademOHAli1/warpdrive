import type { ReactNode } from "react";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/server/trpc/context";
import { LanguageSettings } from "../profile/LanguageSettings";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L._hierarchy.regional };
}

export default async function RegionalPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();
  const { actor } = await createContext();
  if (actor === null) return <p className="text-sm text-destructive">{L.requiresAuth}</p>;
  return (
    <SettingsPage>
      <SettingsHeading
        title={L._hierarchy.regional}
        description={L._hierarchy.regionalDescription}
        scope="personal"
      />
      <LanguageSettings />
    </SettingsPage>
  );
}
