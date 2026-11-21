import { z } from "zod";
import type { ProjectItem, ProjectSummary } from "../contracts";
import { projectPriorities, projectStatuses } from "../contracts";
import { createProjectInput, projectIdInput } from "../input";

const id = projectIdInput;
const plainText = (limit: number) =>
  z
    .string()
    .trim()
    .max(limit)
    .refine((value) => !value.includes("\0") && !/\p{Cs}/u.test(value));
export const planningGroupKinds = ["cycles", "modules"] as const;
export const planningModuleStatuses = [
  "backlog",
  "planned",
  "in-progress",
  "paused",
  "completed",
  "cancelled",
] as const;
export const planningViewLayouts = [
  "list",
  "board",
  "calendar",
  "gantt_chart",
  "spreadsheet",
] as const;
export type PlanningGroupKind = (typeof planningGroupKinds)[number];
export type PlanningModuleStatus = (typeof planningModuleStatuses)[number];
export type PlanningCyclePhase = "draft" | "upcoming" | "current" | "completed";
export type PlanningViewLayout = (typeof planningViewLayouts)[number];
export type PlanningSection = PlanningGroupKind | "views";

export const planningViewFiltersInput = z.strictObject({
  query: plainText(160),
  status: z.union([z.literal(""), z.enum(projectStatuses), id]),
  assignee: z.union([z.literal(""), z.literal("unassigned"), id]),
  priority: z.union([z.literal(""), z.enum(projectPriorities)]),
  cycleId: z.union([z.literal(""), id]),
  moduleId: z.union([z.literal(""), id]),
});

export type PlanningViewFilters = z.infer<typeof planningViewFiltersInput>;
export const emptyPlanningViewFilters: PlanningViewFilters = {
  query: "",
  status: "",
  assignee: "",
  priority: "",
  cycleId: "",
  moduleId: "",
};

export const planningProjectKey = z.strictObject({ projectId: id });
export const planningGroupKey = planningProjectKey.extend({
  groupId: id,
  kind: z.enum(planningGroupKinds),
});
export const planningViewKey = planningProjectKey.extend({ viewId: id });

const action = { expectedActorId: id, csrfToken: z.string().max(128).nullable() };
const content = {
  title: createProjectInput.shape.title,
  description: plainText(4000),
};
const editingRevision = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - 1);
const date = z.iso
  .date()
  .refine((value) => !value.startsWith("0000-"))
  .nullable();
export const savePlanningGroupInput = planningGroupKey.extend({
  ...action,
  ...content,
  revision: editingRevision.nullable(),
  startDate: date,
  endDate: date,
  moduleStatus: z.enum(planningModuleStatuses).nullable(),
});
export const savePlanningViewInput = planningViewKey.extend({
  ...action,
  ...content,
  revision: editingRevision.nullable(),
  visibility: z.enum(["project", "private"]),
  layout: z.enum(planningViewLayouts),
  filters: planningViewFiltersInput,
});
export const setPlanningGroupArchiveInput = planningGroupKey.extend({
  ...action,
  revision: editingRevision,
  archived: z.boolean(),
});
export const setPlanningViewArchiveInput = planningViewKey.extend({
  ...action,
  revision: editingRevision,
  archived: z.boolean(),
});
export const setItemPlanningInput = planningProjectKey
  .extend({
    ...action,
    itemId: id,
    cycleId: id.nullable().optional(),
    moduleIds: z.array(id).max(100).optional(),
  })
  .refine(({ cycleId, moduleIds }) => cycleId !== undefined || moduleIds !== undefined);
export const changePlanningGroupItemsInput = planningGroupKey.extend({
  ...action,
  itemId: id,
  included: z.boolean(),
});

export type SavePlanningGroup = z.infer<typeof savePlanningGroupInput>;
export type SavePlanningView = z.infer<typeof savePlanningViewInput>;
export type SetPlanningGroupArchive = z.infer<typeof setPlanningGroupArchiveInput>;
export type SetPlanningViewArchive = z.infer<typeof setPlanningViewArchiveInput>;
export type SetItemPlanning = z.infer<typeof setItemPlanningInput>;
export type ChangePlanningGroupItems = z.infer<typeof changePlanningGroupItemsInput>;

export type PlanningChoice = { id: string; title: string; archived: boolean };
export type PlanningGroupChoice = PlanningChoice & { acceptsWork: boolean };
export type PlanningScope = { kind: PlanningGroupKind; group: PlanningGroupChoice };
export type PlanningAssignment = { itemId: string; cycleId: string | null; moduleIds: string[] };
export type WorkspacePlanning = {
  cycles: PlanningGroupChoice[];
  modules: PlanningGroupChoice[];
  assignments: PlanningAssignment[];
};

export type PlanningGroup = PlanningChoice & {
  kind: PlanningGroupKind;
  revision: number;
  description: string;
  startDate: string | null;
  endDate: string | null;
  moduleStatus: PlanningModuleStatus | null;
  itemCount: number;
  closedCount: number;
};
export type PlanningSavedView = PlanningChoice & {
  revision: number;
  description: string;
  visibility: "project" | "private";
  layout: PlanningViewLayout;
  filters: PlanningViewFilters;
  canEdit: boolean;
  canArchive: boolean;
};
export type PlanningReadHeader = {
  project: ProjectSummary;
  canEdit: boolean;
  canManageSettings: boolean;
};

export function planningCyclePhase(
  { startDate, endDate }: Pick<PlanningGroup, "startDate" | "endDate">,
  // Cycles use civil dates. A shared UTC date keeps this classification consistent for every member.
  today = new Date().toISOString().slice(0, 10),
): PlanningCyclePhase {
  if (startDate === null || endDate === null) return "draft";
  if (today < startDate) return "upcoming";
  return today > endDate ? "completed" : "current";
}

export function canArchivePlanningGroup(
  group: Pick<PlanningGroup, "kind" | "startDate" | "endDate" | "moduleStatus">,
) {
  return group.kind === "cycles"
    ? planningCyclePhase(group) === "completed"
    : group.moduleStatus === "completed" || group.moduleStatus === "cancelled";
}

export function matchesPlanningFilters(
  item: Pick<ProjectItem, "stateId" | "status" | "assigneeId" | "priority" | "title">,
  filters: PlanningViewFilters,
  assignment?: PlanningAssignment,
  locale?: string,
): boolean {
  const query = filters.query.trim().toLocaleLowerCase(locale);
  return (
    (filters.status === "" || item.status === filters.status || item.stateId === filters.status) &&
    (filters.assignee === "" || (item.assigneeId ?? "unassigned") === filters.assignee) &&
    (filters.priority === "" || item.priority === filters.priority) &&
    (filters.cycleId === "" || assignment?.cycleId === filters.cycleId) &&
    (filters.moduleId === "" || assignment?.moduleIds.includes(filters.moduleId) === true) &&
    item.title.toLocaleLowerCase(locale).includes(query)
  );
}
