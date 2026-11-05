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
    | "update-record"
    | "delete-record"
    | "search-records"
    | "upsert-record"
    | "pick-record"
    | "draft-email"
    | "create-calendar-event"
    | "human-form"
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
    type: "record.update",
    category: "crm",
    categoryKey: "paletteCategoryCrm",
    labelKey: "updateRecord",
    descriptionKey: "updateRecordHint",
    profile: "update-record",
    input: "optional",
  },
  {
    ...insertable,
    type: "record.delete",
    category: "crm",
    categoryKey: "paletteCategoryCrm",
    labelKey: "deleteRecord",
    descriptionKey: "deleteRecordHint",
    profile: "delete-record",
    input: "optional",
  },
  {
    ...insertable,
    type: "record.search",
    category: "crm",
    categoryKey: "paletteCategoryCrm",
    labelKey: "searchRecords",
    descriptionKey: "searchRecordsHint",
    profile: "search-records",
    input: "optional",
  },
  {
    ...insertable,
    type: "record.upsert",
    category: "crm",
    categoryKey: "paletteCategoryCrm",
    labelKey: "upsertRecord",
    descriptionKey: "upsertRecordHint",
    profile: "upsert-record",
    input: "optional",
  },
  {
    ...insertable,
    type: "record.pick",
    category: "crm",
    categoryKey: "paletteCategoryCrm",
    labelKey: "pickRecord",
    descriptionKey: "pickRecordHint",
    profile: "pick-record",
    input: "none",
  },
  {
    ...insertable,
    type: "email.draft",
    category: "crm",
    categoryKey: "paletteCategoryCrm",
    labelKey: "draftEmail",
    descriptionKey: "draftEmailHint",
    profile: "draft-email",
    input: "optional",
  },
  {
    ...insertable,
    type: "calendar.create",
    category: "crm",
    categoryKey: "paletteCategoryCrm",
    labelKey: "createCalendarEvent",
    descriptionKey: "createCalendarEventHint",
    profile: "create-calendar-event",
    input: "optional",
  },
  {
    ...insertable,
    type: "human.form",
    category: "logic",
    categoryKey: "paletteCategoryLogic",
    labelKey: "humanForm",
    descriptionKey: "humanFormHint",
    profile: "human-form",
    input: "none",
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
