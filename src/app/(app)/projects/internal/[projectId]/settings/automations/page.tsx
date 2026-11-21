import { notFound } from "next/navigation";
import { ProjectAutomationClient } from "@/features/projects/automations/ProjectAutomationClient";
import { projectIdInput } from "@/features/projects/input";
import { ProjectTypeNav } from "@/features/projects/ProjectTypeNav";
import { readInternalWorkspace, requireInternalProjects } from "@/features/projects/webReads";
import { coreClient } from "@/frontend/trpc";

export default async function ProjectAutomationsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { actorId } = await requireInternalProjects();
  const id = projectIdInput.safeParse((await params).projectId);
  if (!id.success) notFound();
  const [workspace, automation] = await Promise.all([
    readInternalWorkspace(id.data),
    coreClient().internalProjects.automation.settings.query({ projectId: id.data }),
  ]);
  if (!workspace.ok || !automation.ok || !workspace.value.canManageSettings) notFound();
  return (
    <div className="space-y-4">
      <ProjectTypeNav active="internal" />
      <ProjectAutomationClient
        actorId={actorId}
        workspace={workspace.value}
        initial={automation.value.settings}
        recent={automation.value.recent}
      />
    </div>
  );
}
