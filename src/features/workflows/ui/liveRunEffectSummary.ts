import { validateDefinition } from "../definition";
import { executableDefinition } from "../readiness";
import type { WorkflowNode } from "../schemas";

export interface LiveRunEffects {
  readonly configuredSteps: number;
  readonly counts: {
    readonly start: number;
    readonly read: number;
    readonly task: number;
    readonly condition: number;
    readonly filter?: number;
    readonly ifElse?: number;
    readonly recordCreate?: number;
    readonly recordUpdate?: number;
    readonly recordDelete?: number;
    readonly recordSearch?: number;
    readonly recordPick?: number;
    readonly emailDraft?: number;
    readonly calendarEvent?: number;
    readonly delay: number;
  };
}

interface JsonEntry {
  value: unknown;
  depth: number;
}
interface JsonWork {
  checked: number;
  pending: JsonEntry[];
  seen: Set<object>;
}

const maxJsonEntries = 100_000;
const maxJsonDepth = 32;

function jsonKeys(value: object): string[] | null {
  if (Array.isArray(value)) {
    if (value.length > maxJsonEntries) return null;
    const keys = Object.keys(value);
    return keys.length === value.length && keys.every((key, index) => key === String(index))
      ? keys
      : null;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype ? Object.keys(value) : null;
}

function queueJsonChildren(value: object, depth: number, work: JsonWork): boolean {
  const keys = jsonKeys(value);
  if (
    keys === null ||
    keys.length > maxJsonEntries - work.checked - work.pending.length ||
    Object.getOwnPropertySymbols(value).length > 0
  )
    return false;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return false;
    work.pending.push({ value: descriptor.value, depth: depth + 1 });
  }
  return true;
}

function visitJson(entry: JsonEntry, work: JsonWork): boolean {
  work.checked++;
  if (work.checked > maxJsonEntries || entry.depth > maxJsonDepth) return false;
  const value = entry.value;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || work.seen.has(value)) return false;
  work.seen.add(value);
  return queueJsonChildren(value, entry.depth, work);
}

// Run before the definition schema's recursive JSON parser. Retained publications
// are JSON trees; cyclic, aliased, accessor-bearing or excessive inputs are unavailable.
function boundedJson(input: unknown): boolean {
  const work: JsonWork = { checked: 0, pending: [{ value: input, depth: 0 }], seen: new Set() };
  while (work.pending.length > 0) {
    const entry = work.pending.pop();
    if (entry === undefined || !visitJson(entry, work)) return false;
  }
  return true;
}

const countKey: Partial<Record<WorkflowNode["type"], keyof LiveRunEffects["counts"]>> = {
  "trigger.manual": "start",
  "record.read": "read",
  "activity.create": "task",
  condition: "condition",
  filter: "filter",
  ifElse: "ifElse",
  "record.create": "recordCreate",
  "record.update": "recordUpdate",
  "record.delete": "recordDelete",
  "record.search": "recordSearch",
  "record.pick": "recordPick",
  "email.draft": "emailDraft",
  "calendar.create": "calendarEvent",
  delay: "delay",
};

/** Configured steps only: no evaluated path, current metadata, access or effect guarantee. */
export function projectLiveRunEffects(input: unknown): LiveRunEffects | null {
  try {
    if (!boundedJson(input)) return null;
    const checked = validateDefinition(input);
    if (!checked.ok || !executableDefinition(checked.value)) return null;
    const counts: {
      -readonly [Key in keyof LiveRunEffects["counts"]]: LiveRunEffects["counts"][Key];
    } = { start: 0, read: 0, task: 0, condition: 0, delay: 0 };
    for (const node of checked.value.nodes) {
      const key = countKey[node.type];
      if (key === undefined) return null;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    if (counts.start !== 1) return null;
    return { configuredSteps: checked.value.nodes.length, counts };
  } catch {
    return null;
  }
}
