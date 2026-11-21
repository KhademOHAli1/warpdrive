import { notFound } from "next/navigation";
import { ProjectPagesList } from "@/features/projects/documents/ui/ProjectPagesList";
import { getPageType } from "@/features/projects/documents/ui/planePagesNavigation";
import { readProjectDocuments } from "@/features/projects/documents/webReads";
import { projectIdInput } from "@/features/projects/input";
import { ProjectTypeNav } from "@/features/projects/ProjectTypeNav";
import { readInternalWorkspace, requireInternalProjects } from "@/features/projects/webReads";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const { actorId } = await requireInternalProjects();
  const projectId = projectIdInput.safeParse((await params).projectId);
  if (!projectId.success) notFound();
  const { type } = await searchParams;
  const [index, workspace] = await Promise.all([
    readProjectDocuments(projectId.data),
    readInternalWorkspace(projectId.data),
  ]);
  if (!index.ok || !workspace.ok) notFound();
  return (
    <div className="space-y-4">
      <ProjectTypeNav active="internal" />
      <ProjectPagesList
        actorId={actorId}
        project={workspace.value.project}
        canManageSettings={workspace.value.canManageSettings}
        intakeEnabled={workspace.value.settings.intakeEnabled}
        index={index.value}
        pageType={getPageType(typeof type === "string" ? type : null)}
      />
    </div>
  );
}
