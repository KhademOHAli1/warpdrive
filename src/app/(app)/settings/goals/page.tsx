import type { ReactNode } from "react";
import { todayInZone } from "@/features/goals/todayInZone";
import { getLocalePreferences } from "@/features/i18n/server";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { can } from "@/features/permissions/can";
import { createContext } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";
import { SettingsPage } from "../SettingsSurface";
import { KpiWorkspace } from "./KpiWorkspace";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.goals };
}

export default async function GoalsSettingsPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const { actor } = await createContext();
  // Reading a goal needs no permission; setting someone's quota is administrative, so this
  // screen is gated even though the Performance widget is not.
  if (actor === null || !can(actor, "goals.manage")) {
    return <p className="text-sm text-red-600">{L.requiresAdmin}</p>;
  }
  const { goalRows, users, teamRows, pipelineRows, typeRows, baseCurrency } =
    await coreClient().frontend.goalSettings.query();

  return (
    <SettingsPage className="max-w-6xl">
      <KpiWorkspace
        goals={goalRows}
        baseCurrency={baseCurrency}
        users={users.map((u) => ({ id: u.id, name: u.name }))}
        teams={teamRows}
        pipelines={pipelineRows}
        activityTypes={typeRows}
        today={todayInZone((await getLocalePreferences()).timeZone, new Date())}
      />
    </SettingsPage>
  );
}
