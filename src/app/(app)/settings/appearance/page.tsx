import type { ReactNode } from "react";
import { db } from "@/db/client";
import { getPreferencesForActor } from "@/features/identity/preferencesForActor";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { APPEARANCE_DEFAULT } from "@/features/theme/appearance";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { AppearanceSettings } from "./AppearanceSettings";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L._hierarchy.appearance };
}

export default async function AppearancePage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();
  const { actor } = await createContext();
  if (actor === null) return <p className="text-sm text-destructive">{L.requiresAuth}</p>;
  const prefs = await getPreferencesForActor(db, actor.id);
  return (
    <SettingsPage>
      <SettingsHeading
        title={L._hierarchy.appearance}
        description={L._hierarchy.appearanceDescription}
        scope="personal"
      />
      <AppearanceSettings
        density={prefs.density}
        appearance={prefs.ui.appearance ?? APPEARANCE_DEFAULT}
      />
    </SettingsPage>
  );
}
