import { notFound } from "next/navigation";
import { projectIdInput } from "../input";
import { ProjectTypeNav } from "../ProjectTypeNav";
import { readInternalWorkspace, requireInternalProjects } from "../webReads";
import { ProjectSettingsClient, type ProjectSettingsSection } from "./ProjectSettingsClient";

export async function ProjectSettingsPage({
  params,
  section,
}: {
  params: Promise<{ projectId: string }>;
  section: ProjectSettingsSection;
}) {
  const { actorId } = await requireInternalProjects();
  const id = projectIdInput.safeParse((await params).projectId);
  if (!id.success) notFound();
  const workspace = await readInternalWorkspace(id.data);
  if (!workspace.ok || !workspace.value.canManageSettings) notFound();
  return (
    <div className="space-y-4">
      <ProjectTypeNav active="internal" />
      <ProjectSettingsClient
        key={`${actorId}:${id.data}:${section}`}
        actorId={actorId}
        initial={workspace.value}
        section={section}
      />
    </div>
  );
}
