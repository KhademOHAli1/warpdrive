import { notFound } from "next/navigation";
import { projectIdInput } from "@/features/projects/input";
import { ProjectIntakeSettings } from "@/features/projects/intake/ui/ProjectIntakeSettings";
import { ProjectTypeNav } from "@/features/projects/ProjectTypeNav";
import { readInternalWorkspace, requireInternalProjects } from "@/features/projects/webReads";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { actorId } = await requireInternalProjects();
  const id = projectIdInput.safeParse((await params).projectId);
  if (!id.success) notFound();
  const workspace = await readInternalWorkspace(id.data);
  if (!workspace.ok || !workspace.value.canManageSettings) notFound();
  const { project, settings } = workspace.value;
  return (
    <div className="space-y-4">
      <ProjectTypeNav active="internal" />
      <ProjectIntakeSettings
        actorId={actorId}
        project={project}
        enabled={settings.intakeEnabled}
        revision={settings.revision}
      />
    </div>
  );
}
