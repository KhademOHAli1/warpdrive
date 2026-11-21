import {
  InternalProjectsClient,
  InternalProjectsUnavailable,
} from "@/features/projects/InternalProjectsClient";
import { ProjectTypeNav } from "@/features/projects/ProjectTypeNav";
import { readInternalProjects, requireInternalProjects } from "@/features/projects/webReads";

export default async function InternalProjectsPage() {
  const { actorId } = await requireInternalProjects();
  const index = await readInternalProjects();
  return (
    <div className="space-y-4">
      <ProjectTypeNav active="internal" />
      {index.ok ? (
        <InternalProjectsClient
          key={actorId}
          actorId={actorId}
          screen="index"
          initial={index.value}
        />
      ) : (
        <InternalProjectsUnavailable />
      )}
    </div>
  );
}
