import { notFound } from "next/navigation";
import type { ProjectResult } from "@/features/projects/contracts";
import { InternalProjectsClient } from "@/features/projects/InternalProjectsClient";
import { projectIdInput } from "@/features/projects/input";
import { ProjectTypeNav } from "@/features/projects/ProjectTypeNav";
import type { PlanningScope, WorkspacePlanning } from "@/features/projects/planning/contracts";
import {
  readPlanningSavedView,
  readWorkspacePlanning,
} from "@/features/projects/planning/webReads";
import { resolveProjectView } from "@/features/projects/ui/planeWorkItemView";
import { readInternalWorkspace, requireInternalProjects } from "@/features/projects/webReads";

type QueryValue = string | string[];
type WorkspaceSearch = {
  view?: QueryValue;
  item?: QueryValue;
  savedView?: QueryValue;
  cycleId?: QueryValue;
  moduleId?: QueryValue;
};

function optionalId(raw: QueryValue | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const parsed = projectIdInput.safeParse(raw);
  if (!parsed.success) notFound();
  return parsed.data;
}

function resolvePlanningScope(
  { cycleId, moduleId, savedView }: WorkspaceSearch,
  planning: ProjectResult<WorkspacePlanning>,
): PlanningScope | undefined {
  const raw = cycleId ?? moduleId;
  if (raw === undefined) return undefined;
  if ((cycleId !== undefined && moduleId !== undefined) || savedView !== undefined || !planning.ok)
    notFound();
  const groupId = optionalId(raw);
  const kind = cycleId === undefined ? "modules" : "cycles";
  const group = planning.value[kind].find(({ id }) => id === groupId);
  if (group === undefined) notFound();
  return { kind, group };
}

export default async function InternalProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<WorkspaceSearch>;
}) {
  const { actorId } = await requireInternalProjects();
  const id = projectIdInput.safeParse((await params).projectId);
  if (!id.success) notFound();
  const query = await searchParams;
  const savedViewId = optionalId(query.savedView);
  const [workspace, planning, saved] = await Promise.all([
    readInternalWorkspace(id.data),
    readWorkspacePlanning(id.data),
    savedViewId === undefined ? null : readPlanningSavedView(id.data, savedViewId),
  ]);
  if (!workspace.ok || (saved !== null && !saved.ok)) notFound();
  const savedView = saved?.value;
  const planningScope = resolvePlanningScope(query, planning);
  const item = projectIdInput.safeParse(query.item);
  const location = {
    view: resolveProjectView(
      typeof query.view === "string" ? query.view : (savedView?.layout ?? null),
    ),
    itemId: item.success ? item.data : null,
  };
  return (
    <div className="space-y-4">
      <ProjectTypeNav active="internal" />
      <InternalProjectsClient
        key={`${actorId}:${id.data}:${savedView?.id ?? planningScope?.group.id ?? ""}`}
        actorId={actorId}
        screen="workspace"
        initial={workspace.value}
        location={location}
        planning={planning.ok ? planning.value : undefined}
        savedView={savedView}
        planningScope={planningScope}
      />
    </div>
  );
}
