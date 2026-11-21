import { notFound } from "next/navigation";
import { ProjectArchiveClient } from "@/features/projects/automations/ProjectArchiveClient";
import { projectIdInput } from "@/features/projects/input";
import { ProjectTypeNav } from "@/features/projects/ProjectTypeNav";
import { readInternalWorkspace, requireInternalProjects } from "@/features/projects/webReads";
import { coreClient } from "@/frontend/trpc";

export default async function ProjectArchivePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ item?: string | string[] }>;
}) {
  const { actorId } = await requireInternalProjects();
  const id = projectIdInput.safeParse((await params).projectId);
  if (!id.success) notFound();
  const [workspace, archive, query] = await Promise.all([
    readInternalWorkspace(id.data),
    coreClient().internalProjects.automation.archive.query({ projectId: id.data }),
    searchParams,
  ]);
  if (!workspace.ok || !archive.ok) notFound();
  const item = projectIdInput.safeParse(query.item);
  return (
    <div className="space-y-4">
      <ProjectTypeNav active="internal" />
      <ProjectArchiveClient
        actorId={actorId}
        workspace={workspace.value}
        archived={archive.value}
        initialItemId={item.data}
      />
    </div>
  );
}
