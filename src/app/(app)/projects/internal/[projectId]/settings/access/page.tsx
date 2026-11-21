import { notFound } from "next/navigation";
import { PageHeading } from "@/components/shell/PageHeading";
import { getLocalePreferences } from "@/features/i18n/server";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { guestLabels } from "@/features/projects/guests/messages";
import { ProjectGuestSettings } from "@/features/projects/guests/ProjectGuestSettings";
import { projectIdInput } from "@/features/projects/input";
import { ProjectTypeNav } from "@/features/projects/ProjectTypeNav";
import { ProjectSettingsTabs } from "@/features/projects/settings/ProjectSettingsTabs";
import { ProjectWorkspaceNav } from "@/features/projects/ui/ProjectWorkspaceNav";
import { readInternalWorkspace, requireInternalProjects } from "@/features/projects/webReads";

export default async function AccessPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { actorId } = await requireInternalProjects();
  const projectId = projectIdInput.safeParse((await params).projectId);
  if (!projectId.success) notFound();
  const [workspace, preferences] = await Promise.all([
    readInternalWorkspace(projectId.data),
    getLocalePreferences(),
  ]);
  if (!workspace.ok || !workspace.value.canManageSettings) notFound();
  const { project, settings } = workspace.value;
  return (
    <section className={`${BLOCK_CLASS} ph-no-capture space-y-4`}>
      <ProjectTypeNav active="internal" />
      <PageHeading title={project.title} />
      <ProjectWorkspaceNav
        projectId={project.id}
        active="settings"
        canManageSettings
        intakeEnabled={settings.intakeEnabled}
      />
      <ProjectSettingsTabs projectId={project.id} active="access" />
      <h2 className="font-semibold">{guestLabels[preferences.locale].access}</h2>
      <ProjectGuestSettings
        key={`${actorId}:${project.id}`}
        actorId={actorId}
        project={project}
        settings={settings}
      />
    </section>
  );
}
