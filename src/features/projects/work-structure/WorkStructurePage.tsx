import { notFound } from "next/navigation";
import { projectIdInput } from "../input";
import { ProjectTypeNav } from "../ProjectTypeNav";
import { readInternalWorkspace, requireInternalProjects } from "../webReads";
import { WorkStructureClient, type WorkStructureSection } from "./WorkStructureClient";

export async function WorkStructurePage({
  params,
  section,
}: {
  params: Promise<{ projectId: string }>;
  section: WorkStructureSection;
}) {
  const { actorId } = await requireInternalProjects();
  const id = projectIdInput.safeParse((await params).projectId);
  if (!id.success) notFound();
  const workspace = await readInternalWorkspace(id.data);
  if (!workspace.ok || !workspace.value.canManageSettings) notFound();
  return (
    <div className="space-y-4">
      <ProjectTypeNav active="internal" />
      <WorkStructureClient
        key={`${actorId}:${id.data}:${section}`}
        actorId={actorId}
        initial={workspace.value}
        section={section}
      />
    </div>
  );
}
