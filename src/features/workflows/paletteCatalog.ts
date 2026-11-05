import type { WorkflowNode } from "./schemas";

export type PaletteExecutionReason = "activity-create-required" | "task-type-unavailable";
export interface PaletteEntryState {
  type: WorkflowNode["type"];
  version: 1;
  support: "supported" | "unavailable";
  supportReason: "handler-unavailable" | null;
  provider: "not-required" | "not-assessed";
  executionReasons: PaletteExecutionReason[];
}
export interface WorkflowPaletteSnapshot {
  workflowId: string;
  revision: number;
  authoring: {
    allowed: boolean;
    reason: "workflow-edit-required" | "workflow-archived" | null;
  };
  entries: PaletteEntryState[];
}

interface CatalogDescriptor {
  type: WorkflowNode["type"];
  version: 1;
  category: "triggers" | "crm" | "logic" | "timing";
  categoryKey:
    | "paletteCategoryTriggers"
    | "paletteCategoryCrm"
    | "paletteCategoryLogic"
    | "paletteCategoryTiming";
  labelKey: string;
  descriptionKey: string;
  selection: "insert" | "configure" | "unavailable";
  profile:
    | "manual-trigger"
    | "deal-read"
    | "basic-task"
    | "create-record"
    | "ordered-condition"
    | "scalar-condition"
    | "delay-schedule"
    | "unavailable";
  input: "deal" | "optional" | "scalar" | "none";
  support: PaletteEntryState["support"];
  supportReason: PaletteEntryState["supportReason"];
  provider: PaletteEntryState["provider"];
}

const local = {
  version: 1,
  support: "supported",
  supportReason: null,
  provider: "not-required",
} as const;
const insertable = { ...local, selection: "insert" } as const;
const unavailable = {
  version: 1,
  support: "unavailable",
  supportReason: "handler-unavailable",
  provider: "not-assessed",
  selection: "unavailable",
  profile: "unavailable",
  input: "none",
} as const;

// This finite presentation catalog is not a handler registry or execution grant.
export const paletteCatalog = [
  {
    ...local,
    type: "trigger.manual",
    category: "triggers",
    categoryKey: "paletteCategoryTriggers",
    labelKey: "paletteManual",
    descriptionKey: "paletteManualHint",
    selection: "configure",
    profile: "manual-trigger",
    input: "none",
  },
  {
    ...unavailable,
    type: "trigger.record",
    category: "triggers",
    categoryKey: "paletteCategoryTriggers",
    labelKey: "paletteRecordTrigger",
    descriptionKey: "paletteRecordTriggerHint",
  },
  {
    ...insertable,
    type: "record.create",
    category: "crm",
    categoryKey: "paletteCategoryCrm",
    labelKey: "createRecord",
    descriptionKey: "createRecordHint",
    profile: "create-record",
    input: "optional",
  },
  {
    ...insertable,
    type: "record.read",
    category: "crm",
    categoryKey: "paletteCategoryCrm",
    labelKey: "read",
    descriptionKey: "readActionHint",
    profile: "deal-read",
    input: "deal",
  },
  {
    ...insertable,
    type: "activity.create",
    category: "crm",
    categoryKey: "paletteCategoryCrm",
    labelKey: "task",
    descriptionKey: "taskActionHint",
    profile: "basic-task",
    input: "optional",
  },
  {
    ...unavailable,
    type: "notification",
    category: "crm",
    categoryKey: "paletteCategoryCrm",
    labelKey: "notification",
    descriptionKey: "paletteNotificationHint",
  },
  {
    ...insertable,
    type: "condition",
    category: "logic",
    categoryKey: "paletteCategoryLogic",
    labelKey: "condition",
    descriptionKey: "conditionActionHint",
    profile: "scalar-condition",
    input: "scalar",
  },
  {
    ...insertable,
    type: "filter",
    category: "logic",
    categoryKey: "paletteCategoryLogic",
    labelKey: "filter",
    descriptionKey: "filterActionHint",
    profile: "scalar-condition",
    input: "scalar",
  },
  {
    ...insertable,
    type: "ifElse",
    category: "logic",
    categoryKey: "paletteCategoryLogic",
    labelKey: "ifElseAction",
    descriptionKey: "ifElseActionHint",
    profile: "ordered-condition",
    input: "scalar",
  },
  {
    ...insertable,
    type: "delay",
    category: "timing",
    categoryKey: "paletteCategoryTiming",
    labelKey: "delay",
    descriptionKey: "delayScheduleHint",
    profile: "delay-schedule",
    input: "none",
  },
] as const satisfies readonly CatalogDescriptor[];

export type PaletteCatalogEntry = (typeof paletteCatalog)[number];

export function findPaletteEntry(type: unknown, version: unknown): PaletteCatalogEntry | undefined {
  if (version !== 1) return undefined;
  return paletteCatalog.find((entry) => entry.type === type);
}
