import { notFound } from "next/navigation";
import { InternalProjectsClient } from "@/features/projects/InternalProjectsClient";
import { projectIdInput } from "@/features/projects/input";
import { ProjectTypeNav } from "@/features/projects/ProjectTypeNav";
import { resolveProjectView } from "@/features/projects/ui/planeWorkItemView";
import { readInternalWorkspace, requireInternalProjects } from "@/features/projects/webReads";

export default async function InternalProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ view?: string | string[]; item?: string | string[] }>;
}) {
  const { actorId } = await requireInternalProjects();
  const id = projectIdInput.safeParse((await params).projectId);
  if (!id.success) notFound();
  const workspace = await readInternalWorkspace(id.data);
  if (!workspace.ok) notFound();
  const query = await searchParams;
  const item = projectIdInput.safeParse(query.item);
  const location = {
    view: resolveProjectView(typeof query.view === "string" ? query.view : null),
    itemId: item.success ? item.data : null,
  };
  return (
    <div className="space-y-4">
      <ProjectTypeNav active="internal" />
      <InternalProjectsClient
        key={`${actorId}:${id.data}`}
        actorId={actorId}
        screen="workspace"
        initial={workspace.value}
        location={location}
      />
    </div>
  );
}
