import { notFound } from "next/navigation";
import { InternalProjectsClient } from "@/features/projects/InternalProjectsClient";
import { projectIdInput } from "@/features/projects/input";
import { ProjectTypeNav } from "@/features/projects/ProjectTypeNav";
import { readInternalWorkspace, requireInternalProjects } from "@/features/projects/webReads";

export default async function InternalProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { actorId } = await requireInternalProjects();
  const id = projectIdInput.safeParse((await params).projectId);
  if (!id.success) notFound();
  const workspace = await readInternalWorkspace(id.data);
  if (!workspace.ok) notFound();
  return (
    <div className="space-y-4">
      <ProjectTypeNav active="internal" />
      <InternalProjectsClient
        key={`${actorId}:${id.data}`}
        actorId={actorId}
        screen="workspace"
        initial={workspace.value}
      />
    </div>
  );
}
