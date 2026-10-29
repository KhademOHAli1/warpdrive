import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { DEFAULT_DAILY_ACTIVITY_TARGET } from "@/constants/activityLoad";
import { db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { interfacePrefsFromUi } from "@/features/identity/interfacePrefs";
import { getPreferencesForActor } from "@/features/identity/preferencesForActor";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { DailyActivityTarget } from "./DailyActivityTarget";
import { InterfacePreferences } from "./InterfacePreferences";
import { LanguageSettings } from "./LanguageSettings";
import { ProfileClient } from "./ProfileClient";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.profile };
}

// Personal preferences (Pipedrive "My account"): display name + avatar are editable (avatar via
// the presigned-upload handshake); timezone + interface density persist to user_preferences.
export default async function ProfilePage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const { actor } = await createContext();
  if (actor === null) return <p className="text-sm text-red-600">{L.requiresAuth}</p>;

  const [[me], prefs] = await Promise.all([
    db
      .select({ name: users.name, email: users.email, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, actor.id)),
    getPreferencesForActor(db, actor.id),
  ]);

  return (
    <SettingsPage>
      <SettingsHeading title={L.profile} description={L.profileDescription} />
      <LanguageSettings />
      <ProfileClient
        name={me?.name ?? ""}
        email={me?.email ?? ""}
        avatarUrl={me?.avatarUrl ?? null}
        timezone={prefs.timezone}
        density={prefs.density}
      />
      {/* Appearance lives in the account menu, where people reach for a theme switch. */}
      <InterfacePreferences
        prefs={interfacePrefsFromUi(prefs.ui)}
        scheduleFollowUpAfterWon={prefs.ui.scheduleFollowUpAfterWon ?? false}
      />
      <DailyActivityTarget target={prefs.ui.dailyActivityTarget ?? DEFAULT_DAILY_ACTIVITY_TARGET} />
    </SettingsPage>
  );
}
