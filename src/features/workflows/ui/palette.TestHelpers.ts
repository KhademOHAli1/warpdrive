import { AppError, ERROR_IDS } from "@/constants/errorIds";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import type { WorkflowPaletteSnapshot } from "../paletteCatalog";
import type { WorkflowDefinition } from "../schemas";
import type { PaletteRead } from "./paletteView";

export const paletteWorkflowId = "52f6b244-2ea8-400a-92c9-b584c938562f";
export const paletteLocales = [
  { locale: "en", copy: english },
  { locale: "de", copy: german },
  { locale: "fa", copy: persian },
] as const;

export function paletteSnapshot(
  overrides: Partial<WorkflowPaletteSnapshot> = {},
): WorkflowPaletteSnapshot {
  const types = [
    "trigger.manual",
    "trigger.record",
    "record.create",
    "record.update",
    "record.delete",
    "record.search",
    "record.upsert",
    "record.pick",
    "email.draft",
    "calendar.create",
    "human.form",
    "record.read",
    "activity.create",
    "notification",
    "condition",
    "iterator",
    "filter",
    "ifElse",
    "delay",
  ] as const;
  const entries: WorkflowPaletteSnapshot["entries"] = types.map((type) => {
    const unavailable = type === "trigger.record" || type === "notification";
    return {
      type,
      version: 1,
      support: unavailable ? "unavailable" : "supported",
      supportReason: unavailable ? "handler-unavailable" : null,
      provider: unavailable ? "not-assessed" : "not-required",
      executionReasons: [],
    };
  });
  return {
    workflowId: paletteWorkflowId,
    revision: 1,
    authoring: { allowed: true, reason: null },
    entries,
    ...overrides,
  };
}

export function readyPaletteRead(overrides: Partial<WorkflowPaletteSnapshot> = {}): PaletteRead {
  const data = paletteSnapshot(overrides);
  return {
    workflowId: data.workflowId,
    status: "ready",
    data,
    retry: () => Promise.resolve({ isError: false }),
  };
}

export function paletteDefinition(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [{ id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} }],
    edges: [],
  };
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Deferred resolver not initialized");
  };
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
