import { z } from "zod";
import { revisionSchema } from "@/features/agency-projects/valueSchemas";
import type { ProjectItem, ProjectStateCategory, ProjectSummary } from "../contracts";
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

const civilDate = z.iso.date().refine((value) => !value.startsWith("0000-"));
const filterDate = z.union([z.literal(""), civilDate]).optional();

export const planningViewFiltersInput = z
  .strictObject({
    query: plainText(160),
    status: z.union([z.literal(""), z.enum(projectStatuses), id]),
    assignee: z.union([z.literal(""), z.literal("unassigned"), id]),
    priority: z.union([z.literal(""), z.enum(projectPriorities)]),
    cycleId: z.union([z.literal(""), id]),
    moduleId: z.union([z.literal(""), id]),
    createdBy: z.union([z.literal(""), id]).optional(),
    labelId: z.union([z.literal(""), id]).optional(),
    estimatePointId: z.union([z.literal(""), id]).optional(),
    startFrom: filterDate,
    startTo: filterDate,
    dueFrom: filterDate,
    dueTo: filterDate,
  })
  .refine(
    ({ startFrom = "", startTo = "", dueFrom = "", dueTo = "" }) =>
      (startFrom === "" || startTo === "" || startFrom <= startTo) &&
      (dueFrom === "" || dueTo === "" || dueFrom <= dueTo),
  );

export const planningGroupByOptions = [
  "state",
  "priority",
  "assignee",
  "creator",
  "label",
  "cycle",
  "module",
  "none",
] as const;
export const planningItemScopes = ["all", "active", "backlog"] as const;
export const planningOrderByOptions = [
  "manual",
  "newest",
  "updated",
  "startDate",
  "dueDate",
  "priority",
] as const;
export const planningViewDisplayInput = z
  .strictObject({
    groupBy: z.enum(planningGroupByOptions),
    subGroupBy: z.enum(planningGroupByOptions).default("none"),
    itemScope: z.enum(planningItemScopes).default("all"),
    orderBy: z.enum(planningOrderByOptions),
    showEmptyGroups: z.boolean(),
    showAssignee: z.boolean(),
    showPriority: z.boolean(),
    showStartDate: z.boolean(),
    showDueDate: z.boolean(),
    showKey: z.boolean().default(true),
    showStatus: z.boolean().default(true),
    showLabels: z.boolean().default(true),
    showEstimate: z.boolean().default(true),
  })
  .refine(({ groupBy, subGroupBy }) => subGroupBy === "none" || groupBy !== subGroupBy);
export type PlanningViewDisplay = z.infer<typeof planningViewDisplayInput>;
export type StoredPlanningViewDisplay = z.input<typeof planningViewDisplayInput>;
export const defaultStoredPlanningViewDisplay: StoredPlanningViewDisplay = {
  groupBy: "state",
  orderBy: "manual",
  showEmptyGroups: false,
  showAssignee: true,
  showPriority: true,
  showStartDate: true,
  showDueDate: true,
};
export const defaultPlanningViewDisplay = planningViewDisplayInput.parse(
  defaultStoredPlanningViewDisplay,
);

export function matchesPlanningItemScope(
  scope: PlanningViewDisplay["itemScope"],
  category: ProjectStateCategory | undefined,
): boolean {
  if (scope === "all") return true;
  return scope === "backlog"
    ? category === "backlog"
    : category === "unstarted" || category === "started";
}

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
const date = civilDate.nullable();
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
  display: planningViewDisplayInput.optional(),
});
export const setPlanningViewLockInput = planningViewKey.extend({
  ...action,
  revision: editingRevision,
  locked: z.boolean(),
});
export const setPlanningViewFavoriteInput = planningViewKey.extend({
  ...action,
  favorite: z.boolean(),
});
export const deletePlanningViewInput = planningViewKey.extend({
  ...action,
  revision: revisionSchema,
});
export const rolloverPlanningCycleInput = planningProjectKey.extend({
  ...action,
  sourceCycleId: id,
  targetCycleId: id,
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
export type SetPlanningViewLock = z.infer<typeof setPlanningViewLockInput>;
export type SetPlanningViewFavorite = z.infer<typeof setPlanningViewFavoriteInput>;
export type DeletePlanningView = z.infer<typeof deletePlanningViewInput>;
export type RolloverPlanningCycle = z.infer<typeof rolloverPlanningCycleInput>;
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
  rolloverSnapshot: PlanningCycleRolloverSnapshot | null;
};
export type PlanningCycleRolloverSnapshot = {
  itemCount: number;
  closedCount: number;
  movedCount: number;
  targetCycleId: string;
  recordedAt: string;
};
export type PlanningSavedView = PlanningChoice & {
  revision: number;
  description: string;
  visibility: "project" | "private";
  layout: PlanningViewLayout;
  filters: PlanningViewFilters;
  display: PlanningViewDisplay;
  locked: boolean;
  favorite: boolean;
  canFavorite: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
};
export type PlanningReadHeader = {
  project: ProjectSummary;
  canEdit: boolean;
  canManageSettings: boolean;
  intakeEnabled: boolean;
};

export function planningCyclePhase(
  { startDate, endDate }: Pick<PlanningGroup, "startDate" | "endDate">,
  // Callers with project context supply the project's civil date.
  today = new Date().toISOString().slice(0, 10),
): PlanningCyclePhase {
  if (startDate === null || endDate === null) return "draft";
  if (today < startDate) return "upcoming";
  return today > endDate ? "completed" : "current";
}

export function canArchivePlanningGroup(
  group: Pick<PlanningGroup, "kind" | "startDate" | "endDate" | "moduleStatus">,
  today?: string,
) {
  return group.kind === "cycles"
    ? planningCyclePhase(group, today) === "completed"
    : group.moduleStatus === "completed" || group.moduleStatus === "cancelled";
}

export function matchesPlanningFilters(
  item: Pick<
    ProjectItem,
    | "stateId"
    | "status"
    | "assigneeId"
    | "priority"
    | "title"
    | "createdBy"
    | "startDate"
    | "dueDate"
  > &
    Partial<Pick<ProjectItem, "labelIds" | "estimatePointId">>,
  filters: PlanningViewFilters,
  assignment?: PlanningAssignment,
  locale?: string,
): boolean {
  const query = filters.query.trim().toLocaleLowerCase(locale);
  const { createdBy = "", labelId = "", estimatePointId = "" } = filters;
  return (
    (filters.status === "" || item.status === filters.status || item.stateId === filters.status) &&
    (filters.assignee === "" || (item.assigneeId ?? "unassigned") === filters.assignee) &&
    (filters.priority === "" || item.priority === filters.priority) &&
    (filters.cycleId === "" || assignment?.cycleId === filters.cycleId) &&
    (filters.moduleId === "" || assignment?.moduleIds.includes(filters.moduleId) === true) &&
    (createdBy === "" || item.createdBy === createdBy) &&
    (labelId === "" || item.labelIds?.includes(labelId) === true) &&
    (estimatePointId === "" || item.estimatePointId === estimatePointId) &&
    matchesDateRange(item.startDate, filters.startFrom, filters.startTo) &&
    matchesDateRange(item.dueDate, filters.dueFrom, filters.dueTo) &&
    item.title.toLocaleLowerCase(locale).includes(query)
  );
}

function matchesDateRange(date: string | null, from = "", to = "") {
  if (from === "" && to === "") return true;
  return date !== null && (from === "" || date >= from) && (to === "" || date <= to);
}

function compareDates(left: string | null | undefined, right: string | null | undefined) {
  if (left == null) return right == null ? 0 : 1;
  return right == null ? -1 : left.localeCompare(right);
}

function compareNewest(left: string | undefined, right: string | undefined) {
  return left === undefined || right === undefined
    ? compareDates(left, right)
    : compareDates(right, left);
}

export function sortPlanningViewItems<
  T extends Pick<ProjectItem, "sequenceNumber" | "priority" | "startDate" | "dueDate"> & {
    createdAt?: string;
    updatedAt?: string;
  },
>(items: readonly T[], order: PlanningViewDisplay["orderBy"]): T[] {
  const comparators = {
    manual: (a: T, b: T) => a.sequenceNumber - b.sequenceNumber,
    newest: (a: T, b: T) =>
      compareNewest(a.createdAt, b.createdAt) || b.sequenceNumber - a.sequenceNumber,
    updated: (a: T, b: T) =>
      compareNewest(a.updatedAt, b.updatedAt) || b.sequenceNumber - a.sequenceNumber,
    startDate: (a: T, b: T) => compareDates(a.startDate, b.startDate),
    dueDate: (a: T, b: T) => compareDates(a.dueDate, b.dueDate),
    priority: (a: T, b: T) =>
      projectPriorities.indexOf(a.priority) - projectPriorities.indexOf(b.priority),
  };
  return [...items].sort(comparators[order]);
}
