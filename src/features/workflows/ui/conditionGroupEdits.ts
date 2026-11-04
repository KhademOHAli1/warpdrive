import { parseConditionConfig } from "../conditionExpression";
import type { WorkflowNode } from "../schemas";
export type ConditionJson = WorkflowNode["config"][string];
export type ConditionObject = { [key: string]: ConditionJson };
export function conditionObject(value: ConditionJson | undefined): ConditionObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
export function conditionChildren(value: ConditionObject): ConditionJson[] {
  const children = value.children;
  return isConditionArray(children) ? children : [];
}
function isConditionArray(value: ConditionJson | undefined): value is ConditionJson[] {
  return Array.isArray(value);
}
export function conditionRoot(config: WorkflowNode["config"]) {
  const parsed = parseConditionConfig(config, "draft");
  return parsed.ok && parsed.value.kind === "grouped"
    ? conditionObject(config.expression)
    : undefined;
}
function at(root: ConditionObject, indices: readonly number[]): ConditionObject | undefined {
  let current: ConditionObject | undefined = root;
  for (const index of indices)
    current =
      current === undefined ? undefined : conditionObject(conditionChildren(current)[index]);
  return current;
}
function replace(
  root: ConditionObject,
  indices: readonly number[],
  change: (entry: ConditionObject) => ConditionObject | undefined,
): ConditionObject | undefined {
  const index = indices[0];
  if (index === undefined) return change(root);
  const children = conditionChildren(root);
  const child = conditionObject(children[index]);
  if (child === undefined) return root;
  const next = replace(child, indices.slice(1), change);
  const updated =
    next === undefined
      ? children.filter((_, position) => position !== index)
      : children.map((item, position) => (position === index ? next : item));
  return { ...root, children: updated };
}
export function editCondition(
  config: WorkflowNode["config"],
  indices: readonly number[],
  expectedId: string | undefined,
  change: (entry: ConditionObject) => ConditionObject | undefined,
) {
  const root = conditionRoot(config);
  if (root === undefined) return undefined;
  const current = at(root, indices);
  if (current === undefined || current.id !== expectedId) return undefined;
  const expression = replace(root, indices, change);
  if (expression === undefined) return undefined;
  const next = { ...config, expression };
  return parseConditionConfig(next, "draft").ok ? next : undefined;
}
function identifiers(entry: ConditionObject): string[] {
  const own = typeof entry.id === "string" ? [entry.id] : [];
  return own.concat(
    conditionChildren(entry).flatMap((child) => {
      const object = conditionObject(child);
      return object === undefined ? [] : identifiers(object);
    }),
  );
}
export function newConditionEntry(
  config: WorkflowNode["config"],
  kind: "predicate" | "group",
): ConditionObject & { id: string; kind: "predicate" | "group" } {
  const root = conditionRoot(config);
  const used = new Set(root === undefined ? [] : identifiers(root));
  let number = 1;
  while (used.has("condition_" + number)) number++;
  return kind === "group"
    ? { kind, id: "condition_" + number, operator: "and", children: [] }
    : { kind, id: "condition_" + number, operator: "equals" };
}
export function appendCondition(
  config: WorkflowNode["config"],
  indices: readonly number[],
  id: string | undefined,
  kind: "predicate" | "group",
) {
  return editCondition(config, indices, id, (entry) => ({
    ...entry,
    children: [...conditionChildren(entry), newConditionEntry(config, kind)],
  }));
}
export function moveCondition(
  config: WorkflowNode["config"],
  indices: readonly number[],
  id: string | undefined,
  direction: -1 | 1,
) {
  const root = conditionRoot(config);
  if (root === undefined || at(root, indices)?.id !== id) return undefined;
  const index = indices.at(-1);
  const parentPath = indices.slice(0, -1);
  const parent = at(root, parentPath);
  if (index === undefined || parent === undefined) return undefined;
  const children = conditionChildren(parent);
  const destination = index + direction;
  if (destination < 0 || destination >= children.length) return undefined;
  return editCondition(
    config,
    parentPath,
    typeof parent.id === "string" ? parent.id : undefined,
    (entry) => ({
      ...entry,
      children: children.map((child, position) =>
        position === index
          ? (children[destination] ?? child)
          : position === destination
            ? (children[index] ?? child)
            : child,
      ),
    }),
  );
}
export function convertCondition(config: WorkflowNode["config"]) {
  const parsed = parseConditionConfig(config, "draft");
  if (!parsed.ok || parsed.value.kind !== "legacy") return undefined;
  const converted = {
    expression: {
      kind: "group",
      id: "condition_group",
      operator: "and",
      children: [{ kind: "predicate", id: "condition_rule", ...config }],
    },
    defaultPort: "false",
  };
  return parseConditionConfig(converted, "draft").ok ? converted : undefined;
}
