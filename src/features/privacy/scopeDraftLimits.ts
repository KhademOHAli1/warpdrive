export const SCOPE_DRAFT_CATEGORY_LIMIT = 128;
export const SCOPE_DRAFT_RECORD_LIMIT = 10_000;
export const SCOPE_DRAFT_FIELD_LIMIT = 32;
export const SCOPE_DRAFT_BYTES_LIMIT = 32 * 1024 * 1024;

type BudgetResult = "ok" | "invalid" | "limit";
type Budget = { nodes: number; strings: number; records: number; ancestors: Set<object> };

function plainContainer(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return Array.isArray(value)
    ? prototype === Array.prototype
    : prototype === Object.prototype || prototype === null;
}

function collectionBudget(key: string, length: number, budget: Budget): boolean {
  if (key === "categories") return length <= SCOPE_DRAFT_CATEGORY_LIMIT;
  if (key === "records") {
    budget.records += length;
    return budget.records <= SCOPE_DRAFT_RECORD_LIMIT;
  }
  return !["fields", "decisions", "provenance"].includes(key) || length <= SCOPE_DRAFT_FIELD_LIMIT;
}

function visitProperties(
  value: object,
  budget: Budget,
  depth: number,
  signal: AbortSignal,
): BudgetResult {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || key.length > 80) return "invalid";
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return "invalid";
    const child: unknown = descriptor.value;
    if (Array.isArray(child) && !collectionBudget(key, child.length, budget)) return "limit";
    const result = visit(child, budget, depth + 1, signal);
    if (result !== "ok") return result;
  }
  return "ok";
}

function visit(value: unknown, budget: Budget, depth: number, signal: AbortSignal): BudgetResult {
  signal.throwIfAborted();
  if (++budget.nodes > 1_000_000 || depth > 16) return "limit";
  if (typeof value === "string") {
    budget.strings += value.length;
    return value.length > 256 || budget.strings > SCOPE_DRAFT_BYTES_LIMIT ? "limit" : "ok";
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return "ok";
  if (typeof value !== "object") return "invalid";
  if (!plainContainer(value)) return "invalid";
  if (budget.ancestors.has(value)) return "invalid";
  budget.ancestors.add(value);
  try {
    return visitProperties(value, budget, depth, signal);
  } finally {
    budget.ancestors.delete(value);
  }
}

// Inspect descriptors before Zod so raw in-process getters cannot execute during validation.
export function checkScopeDraftBudget(value: unknown, signal: AbortSignal): BudgetResult {
  try {
    return visit(value, { nodes: 0, strings: 0, records: 0, ancestors: new Set() }, 0, signal);
  } catch {
    signal.throwIfAborted();
    return "invalid";
  }
}
