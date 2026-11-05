import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import { validateDefinition } from "./definition";
import type { WorkflowDefinition } from "./schemas";

export const draftSimulationInputLimits = {
  entries: 100_000,
  depth: 32,
  textUnits: 1_000_000,
  serializedUnits: 1_000_000,
} as const;

const inputSchema = z.strictObject({
  workflowId: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
  recordId: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
  definition: z.unknown(),
});

type JsonVisit =
  | { kind: "value"; value: unknown; depth: number }
  | { kind: "leave"; value: object };
interface JsonWork {
  pending: JsonVisit[];
  ancestors: Set<object>;
  entries: number;
  textUnits: number;
}

export interface PreparedDraftSimulationInput {
  workflowId: string;
  recordId: string;
  definition: WorkflowDefinition;
  // Owned raw-order clone. Serialize/hash only after current metadata validation;
  // never substitute the schema-parsed graph or expose this in the receipt.
  authoredDefinition: unknown;
}

function plainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function dataProperty(value: object, key: string) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    descriptor.enumerable === true &&
    Object.hasOwn(descriptor, "value")
    ? descriptor
    : null;
}

function jsonKeys(value: object): string[] | null {
  if (Object.getOwnPropertySymbols(value).length !== 0) return null;
  const keys = Object.getOwnPropertyNames(value);
  if (!Array.isArray(value)) return plainObject(value) ? keys : null;
  if (value.length > draftSimulationInputLimits.entries || keys.length !== value.length + 1)
    return null;
  const indices = keys.filter((key) => key !== "length");
  return indices.length === value.length && indices.every((key, index) => key === String(index))
    ? indices
    : null;
}

function addText(work: JsonWork, units: number): boolean {
  work.textUnits += units;
  return work.textUnits <= draftSimulationInputLimits.textUnits;
}

function queueChildren(value: object, depth: number, work: JsonWork): boolean {
  const keys = jsonKeys(value);
  if (keys === null || work.entries + keys.length > draftSimulationInputLimits.entries)
    return false;
  work.entries += keys.length;
  work.ancestors.add(value);
  work.pending.push({ kind: "leave", value });
  for (let index = keys.length - 1; index >= 0; index--) {
    const key = keys[index];
    if (key === undefined) return false;
    const descriptor = dataProperty(value, key);
    if (descriptor === null || !addText(work, key.length)) return false;
    work.pending.push({ kind: "value", value: descriptor.value, depth: depth + 1 });
  }
  return true;
}

function visitValue(entry: Extract<JsonVisit, { kind: "value" }>, work: JsonWork): boolean {
  if (entry.depth > draftSimulationInputLimits.depth) return false;
  const value = entry.value;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return addText(work, value.length);
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || work.ancestors.has(value)) return false;
  return queueChildren(value, entry.depth, work);
}

// JSON.stringify expands shared aliases. Budget that expanded traversal while
// rejecting actual ancestry cycles before any recursive schema or serialization.
export function boundedDraftSimulationJson(raw: unknown): boolean {
  const work: JsonWork = {
    pending: [{ kind: "value", value: raw, depth: 0 }],
    ancestors: new Set(),
    entries: 1,
    textUnits: 0,
  };
  try {
    while (work.pending.length > 0) {
      const entry = work.pending.pop();
      if (entry === undefined) return false;
      if (entry.kind === "leave") work.ancestors.delete(entry.value);
      else if (!visitValue(entry, work)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function safeEnvelope(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || !plainObject(raw))
    return false;
  const keys = jsonKeys(raw);
  return (
    keys !== null &&
    keys.length === 3 &&
    keys.every(
      (key) =>
        ["workflowId", "recordId", "definition"].includes(key) && dataProperty(raw, key) !== null,
    )
  );
}

export function prepareDraftSimulationInput(
  raw: unknown,
): Result<PreparedDraftSimulationInput, typeof ERROR_IDS.WORKFLOW_INVALID> {
  let envelope = false;
  try {
    envelope = safeEnvelope(raw);
  } catch {
    return err(ERROR_IDS.WORKFLOW_INVALID);
  }
  if (!envelope) return err(ERROR_IDS.WORKFLOW_INVALID);
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success || !boundedDraftSimulationJson(parsed.data.definition))
    return err(ERROR_IDS.WORKFLOW_INVALID);
  const checked = validateDefinition(parsed.data.definition);
  if (!checked.ok) return err(ERROR_IDS.WORKFLOW_INVALID);
  return ok({
    workflowId: parsed.data.workflowId,
    recordId: parsed.data.recordId,
    definition: checked.value,
    authoredDefinition: structuredClone(parsed.data.definition),
  });
}
