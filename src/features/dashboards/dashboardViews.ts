export type DashboardSelection = { kind: "pipeline"; pipelineId: string } | { kind: "performance" };

export type PipelineDashboardView = "board" | "list" | "archived";

export function dashboardViewHref(
  selection: DashboardSelection,
  pipelineView: PipelineDashboardView = "board",
): string {
  if (selection.kind === "performance") return "/dashboard";
  const suffix = pipelineView === "board" ? "" : `/${pipelineView}`;
  return `/pipeline/${encodeURIComponent(selection.pipelineId)}${suffix}`;
}

export function isCurrentDashboard(
  current: DashboardSelection | null,
  candidate: DashboardSelection,
): boolean {
  if (current === null || current.kind !== candidate.kind) return false;
  return (
    current.kind === "performance" ||
    (candidate.kind === "pipeline" && current.pipelineId === candidate.pipelineId)
  );
}
