import { getLocalePreferences } from "@/features/i18n/server";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { workflowRuntimeMessages } from "@/features/workflows/v2/workflowRuntimeMessages";
import { createContext } from "@/frontend/context";
import { readWorkflowRuntime } from "@/frontend/reads";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { WorkflowRuntimeClient } from "./WorkflowRuntimeClient";

export async function generateMetadata() {
  return { title: workflowRuntimeMessages((await getLocalePreferences()).locale).title };
}
export default async function WorkflowRuntimePage() {
  const { actor } = await createContext();
  if (actor?.type !== "admin")
    return (
      <p className="text-sm text-destructive">
        {(await getServerSettingsMessages()).requiresAdmin}
      </p>
    );
  const L = workflowRuntimeMessages((await getLocalePreferences()).locale);
  const snapshot = await readWorkflowRuntime();
  return (
    <SettingsPage>
      <SettingsHeading scope="workspace" title={L.title} description={L.description} />
      {snapshot.ok ? (
        <WorkflowRuntimeClient initial={snapshot.value} />
      ) : (
        <p role="alert" className="text-sm text-destructive">
          {L.failed}
        </p>
      )}
    </SettingsPage>
  );
}
