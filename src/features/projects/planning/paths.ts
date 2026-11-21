import type { PlanningGroupKind, PlanningSection, PlanningViewLayout } from "./contracts";

export function planningPath(projectId: string, section?: PlanningSection, entryId?: string) {
  const root = `/projects/internal/${encodeURIComponent(projectId)}`;
  return section === undefined
    ? root
    : `${root}/${section}${entryId === undefined ? "" : `/${encodeURIComponent(entryId)}`}`;
}

export function openPlanningViewPath(projectId: string, viewId: string) {
  return `${planningPath(projectId)}?${new URLSearchParams({ savedView: viewId })}`;
}

export function openPlanningGroupPath(
  projectId: string,
  kind: PlanningGroupKind,
  groupId: string,
  view: PlanningViewLayout,
) {
  const key = kind === "cycles" ? "cycleId" : "moduleId";
  return `${planningPath(projectId)}?${new URLSearchParams({ [key]: groupId, view })}`;
}

export function planningItemPath(projectId: string, itemId: string) {
  return `${planningPath(projectId)}?${new URLSearchParams({ item: itemId })}`;
}
