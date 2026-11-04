import { err, ok, type Result } from "@/types/result";
import { scalarLiteralTypes } from "./mappingLiteralIntent";

export const conditionExpressionLimits = {
  depth: 3,
  predicates: 32,
  children: 8,
  nodes: 48,
} as const;
export interface ConditionBudgetIssue {
  path: readonly string[];
  code: "out_of_range" | "invalid_value";
  params?: Readonly<Record<string, string | number>>;
}
export interface RawConditionEntry {
  raw: unknown;
  path: readonly string[];
  depth: number;
}
interface WalkState {
  nodes: RawConditionEntry[];
  pending: RawConditionEntry[];
  seen: Set<object>;
  predicates: number;
}

export function conditionRecord(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}
export function rawConditionGroup(raw: Record<string, unknown>): boolean {
  return (
    raw.kind === "group" ||
    Object.hasOwn(raw, "children") ||
    raw.operator === "and" ||
    raw.operator === "or"
  );
}
function limit(path: readonly string[], bound: number): ConditionBudgetIssue {
  return { path, code: "out_of_range", params: { limit: bound } };
}
function enqueueChildren(
  entry: RawConditionEntry,
  raw: Record<string, unknown>,
  state: WalkState,
): ConditionBudgetIssue | null {
  if (entry.depth > conditionExpressionLimits.depth)
    return limit(entry.path, conditionExpressionLimits.depth);
  const children = raw.children;
  if (!Array.isArray(children)) return null;
  if (children.length > conditionExpressionLimits.children)
    return limit([...entry.path, "children"], conditionExpressionLimits.children);
  for (let index = children.length - 1; index >= 0; index--)
    state.pending.push({
      raw: children[index],
      path: [...entry.path, "children", String(index)],
      depth: entry.depth + 1,
    });
  return null;
}
function visit(entry: RawConditionEntry, state: WalkState): ConditionBudgetIssue | null {
  state.nodes.push(entry);
  if (state.nodes.length > conditionExpressionLimits.nodes)
    return limit(entry.path, conditionExpressionLimits.nodes);
  if (!conditionRecord(entry.raw)) return null;
  if (state.seen.has(entry.raw)) return { path: entry.path, code: "invalid_value" };
  state.seen.add(entry.raw);
  if (rawConditionGroup(entry.raw)) return enqueueChildren(entry, entry.raw, state);
  state.predicates++;
  return state.predicates > conditionExpressionLimits.predicates
    ? limit(entry.path, conditionExpressionLimits.predicates)
    : null;
}
// This module deliberately does not import workflow schemas: it must run before
// their recursive JSON parser at every structural definition/copy boundary.
export function conditionBudgetWalk(
  raw: unknown,
): Result<RawConditionEntry[], ConditionBudgetIssue[]> {
  if (!conditionRecord(raw) || !Object.hasOwn(raw, "expression")) return ok([]);
  if (raw.expression === undefined) return ok([]);
  const state: WalkState = {
    nodes: [],
    pending: [{ raw: raw.expression, path: ["expression"], depth: 1 }],
    seen: new Set(),
    predicates: 0,
  };
  while (state.pending.length > 0) {
    const entry = state.pending.pop();
    if (entry === undefined) break;
    const issue = visit(entry, state);
    if (issue !== null) return err([issue]);
  }
  return ok(state.nodes);
}
function keysAllowed(raw: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(raw).every((key) => allowed.includes(key));
}
function optionalString(raw: Record<string, unknown>, key: string): boolean {
  return !Object.hasOwn(raw, key) || typeof raw[key] === "string";
}
function scalarValue(raw: unknown): boolean {
  if (raw === null || typeof raw === "boolean") return true;
  if (typeof raw === "string") return raw.length <= 50000;
  return typeof raw === "number" && Number.isFinite(raw);
}
function referenceShape(raw: Record<string, unknown>): boolean {
  if (!keysAllowed(raw, ["kind", "nodeId", "path"])) return false;
  if (Object.hasOwn(raw, "kind") && raw.kind !== "reference") return false;
  if (
    Object.hasOwn(raw, "nodeId") &&
    (typeof raw.nodeId !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(raw.nodeId))
  )
    return false;
  if (!Object.hasOwn(raw, "path")) return true;
  return (
    Array.isArray(raw.path) &&
    raw.path.length <= 8 &&
    raw.path.every(
      (part: unknown) =>
        typeof part === "string" &&
        part.length > 0 &&
        part.length <= 80 &&
        !["__proto__", "prototype", "constructor"].includes(part),
    )
  );
}
function literalShape(raw: Record<string, unknown>): boolean {
  if (!keysAllowed(raw, ["kind", "value", "literalType"])) return false;
  if (Object.hasOwn(raw, "kind") && raw.kind !== "value") return false;
  if (Object.hasOwn(raw, "value") && !scalarValue(raw.value)) return false;
  return (
    !Object.hasOwn(raw, "literalType") ||
    scalarLiteralTypes.some((type) => type === raw.literalType)
  );
}
function operandShape(raw: Record<string, unknown>, key: string): boolean {
  if (!Object.hasOwn(raw, key)) return true;
  const binding = raw[key];
  if (!conditionRecord(binding)) return false;
  return binding.kind === "reference" ||
    Object.hasOwn(binding, "nodeId") ||
    Object.hasOwn(binding, "path")
    ? referenceShape(binding)
    : literalShape(binding);
}
function entryShape(entry: RawConditionEntry): boolean {
  if (!conditionRecord(entry.raw)) return false;
  const raw = entry.raw;
  if (
    !optionalString(raw, "kind") ||
    !optionalString(raw, "id") ||
    !optionalString(raw, "operator")
  )
    return false;
  if (entry.path.length === 1 || rawConditionGroup(raw)) {
    return (
      keysAllowed(raw, ["kind", "id", "operator", "children"]) &&
      (!Object.hasOwn(raw, "kind") || raw.kind === "group") &&
      (!Object.hasOwn(raw, "children") || Array.isArray(raw.children))
    );
  }
  return (
    keysAllowed(raw, ["kind", "id", "operator", "left", "right"]) &&
    (!Object.hasOwn(raw, "kind") || raw.kind === "predicate") &&
    operandShape(raw, "left") &&
    operandShape(raw, "right")
  );
}
export function boundedConditionConfig(raw: unknown): boolean {
  if (!conditionRecord(raw)) return true;
  if (!Object.hasOwn(raw, "expression") && !Object.hasOwn(raw, "defaultPort")) return true;
  if (!keysAllowed(raw, ["expression", "defaultPort"]) || !optionalString(raw, "defaultPort"))
    return false;
  const walk = conditionBudgetWalk(raw);
  return walk.ok && walk.value.every(entryShape);
}
