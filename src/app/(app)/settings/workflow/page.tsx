import type { ReactNode } from "react";
import { DEFAULT_DAILY_ACTIVITY_TARGET } from "@/constants/activityLoad";
import { interfacePrefsFromUi } from "@/features/identity/interfacePrefs";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/frontend/context";
import { getPreferencesForActor } from "@/frontend/reads";
import { DailyActivityTarget } from "../profile/DailyActivityTarget";
import { InterfacePreferences } from "../profile/InterfacePreferences";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L._hierarchy.workflow };
}

export default async function WorkflowPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();
  const { actor } = await createContext();
  if (actor === null) return <p className="text-sm text-destructive">{L.requiresAuth}</p>;
  const prefs = await getPreferencesForActor();
  return (
    <SettingsPage>
      <SettingsHeading
        title={L._hierarchy.workflow}
        description={L._hierarchy.workflowDescription}
        scope="personal"
      />
      <InterfacePreferences
        prefs={interfacePrefsFromUi(prefs.ui)}
        scheduleFollowUpAfterWon={prefs.ui.scheduleFollowUpAfterWon ?? false}
      />
      <DailyActivityTarget target={prefs.ui.dailyActivityTarget ?? DEFAULT_DAILY_ACTIVITY_TARGET} />
    </SettingsPage>
  );
}
