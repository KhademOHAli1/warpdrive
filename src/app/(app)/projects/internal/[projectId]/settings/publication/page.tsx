import { notFound } from "next/navigation";
import { projectIdInput } from "@/features/projects/input";
import { ProjectTypeNav } from "@/features/projects/ProjectTypeNav";
import { PublicationSettings } from "@/features/projects/publication/PublicationSettings";
import { readPublicationSettingsFromCore } from "@/features/projects/publication/webReads";
import { readInternalWorkspace, requireInternalProjects } from "@/features/projects/webReads";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { actorId } = await requireInternalProjects();
  const id = projectIdInput.safeParse((await params).projectId);
  if (!id.success) notFound();
  const [workspace, publication] = await Promise.all([
    readInternalWorkspace(id.data),
    readPublicationSettingsFromCore(id.data),
  ]);
  if (!workspace.ok || !workspace.value.canManageSettings || !publication.ok) notFound();
  return (
    <div className="space-y-4">
      <ProjectTypeNav active="internal" />
      <PublicationSettings
        key={`${actorId}:${id.data}`}
        actorId={actorId}
        project={workspace.value.project}
        initial={publication.value}
      />
    </div>
  );
}
