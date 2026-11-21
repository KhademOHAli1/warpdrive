import {
  type ProjectItem,
  type ProjectPriority,
  type ProjectWorkflowState,
  type ProjectWorkspace,
  projectPriorities,
} from "../contracts";
import type { WorkspacePlanning } from "../planning/contracts";
import type { ProjectsTranslator } from "./projectMessages";
import { workflowStateLabel } from "./projectWorkflowUi";

export type WorkItemGroupKind =
  | "state"
  | "priority"
  | "assignee"
  | "creator"
  | "label"
  | "cycle"
  | "module"
  | "none";
type RelatedGroupKind = Exclude<WorkItemGroupKind, "state" | "priority" | "none">;
export type WorkItemGroup = {
  id: string;
  title: string;
  items: ProjectItem[];
  state?: ProjectWorkflowState;
  priority?: ProjectPriority;
  related?: { kind: RelatedGroupKind; value: string | null };
};

function relatedWorkGroups(
  items: ProjectItem[],
  options: { id: string; name: string }[],
  values: (item: ProjectItem) => readonly string[],
  kind: RelatedGroupKind,
  unassigned: string,
): WorkItemGroup[] {
  const byId = new Map(
    options.map(({ id, name }) => [id, { id, name, items: [] as ProjectItem[] }]),
  );
  const missing: ProjectItem[] = [];
  for (const item of items) {
    const membership = values(item).flatMap((id) => byId.get(id) ?? []);
    for (const group of membership) group.items.push(item);
    if (membership.length === 0) missing.push(item);
  }
  return [
    ...Array.from(byId.values(), ({ id, name, items }) => ({
      id,
      title: name,
      items,
      related: { kind, value: id },
    })),
    { id: `unassigned-${kind}`, title: unassigned, items: missing, related: { kind, value: null } },
  ];
}

function peopleGroups(
  workspace: ProjectWorkspace,
  labels: ProjectsTranslator,
  kind: "assignee" | "creator",
) {
  const people = [workspace.project.owner, ...workspace.members.map(({ person }) => person)];
  return relatedWorkGroups(
    workspace.items,
    people,
    (item) => {
      const id = kind === "creator" ? item.createdBy : item.assigneeId;
      return id === null ? [] : [id];
    },
    kind,
    labels(kind === "creator" ? "planning.noCreator" : "workspace.unassigned"),
  );
}

function planningGroups(
  workspace: ProjectWorkspace,
  labels: ProjectsTranslator,
  kind: "cycle" | "module",
  planning?: WorkspacePlanning,
) {
  const choices = (kind === "cycle" ? planning?.cycles : planning?.modules) ?? [];
  const assignments = new Map(planning?.assignments.map((entry) => [entry.itemId, entry]));
  return relatedWorkGroups(
    workspace.items,
    choices.map(({ id, title }) => ({ id, name: title })),
    ({ id }) => {
      const entry = assignments.get(id);
      if (kind === "module") return entry?.moduleIds ?? [];
      return entry?.cycleId == null ? [] : [entry.cycleId];
    },
    kind,
    labels(kind === "cycle" ? "planning.noCycle" : "planning.noModules"),
  );
}

export function projectWorkItemGroups(
  workspace: ProjectWorkspace,
  labels: ProjectsTranslator,
  groupBy: WorkItemGroupKind,
  planning?: WorkspacePlanning,
): WorkItemGroup[] {
  const { items, states } = workspace;
  switch (groupBy) {
    case "none":
      return [{ id: "all", title: labels("workspace.workItems"), items }];
    case "priority":
      return projectPriorities.map((priority) => ({
        id: priority,
        priority,
        title: labels(`priority.${priority}`),
        items: items.filter((item) => item.priority === priority),
      }));
    case "state":
      return states.map((state) => ({
        id: state.id,
        state,
        title: workflowStateLabel(state, labels),
        items: items.filter(({ stateId }) => stateId === state.id),
      }));
    case "assignee":
    case "creator":
      return peopleGroups(workspace, labels, groupBy);
    case "label":
      return relatedWorkGroups(
        items,
        workspace.workStructure.labels.filter(({ kind }) => kind === "label"),
        ({ labelIds }) => labelIds,
        groupBy,
        labels("planning.noLabels"),
      );
    case "cycle":
    case "module":
      return planningGroups(workspace, labels, groupBy, planning);
  }
}
