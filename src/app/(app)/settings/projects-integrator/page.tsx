import { notFound } from "next/navigation";
import { ProjectIntegratorSettings } from "@/features/projects/integrator/ProjectIntegratorSettings";
import { requireInternalProjects } from "@/features/projects/webReads";
import { coreClient } from "@/frontend/trpc";

export default async function Page() {
  const { actorId } = await requireInternalProjects();
  const keys = await coreClient().internalProjects.integrator.keys.query();
  if (!keys.ok) notFound();
  return <ProjectIntegratorSettings key={actorId} actorId={actorId} initial={keys.value} />;
}
