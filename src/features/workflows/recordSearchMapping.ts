import type { ReferenceBinding, WorkflowNode } from "./schemas";
import {
  type RecordSearchDraftConfig,
  type RecordSearchFilterEntry,
  recordSearchBindingEntries,
  recordSearchBindingTarget,
  recordSearchDraftConfig,
} from "./workflowRecordQueryContract";

function conditionAt(filter: RecordSearchDraftConfig["filter"], path: readonly string[]) {
  let entry: RecordSearchFilterEntry | undefined = filter;
  for (let i = 1; i < path.length - 1; i += 2) {
    const ordinal = path[i + 1];
    if (
      path[i] !== "entries" ||
      ordinal === undefined ||
      !/^\d+$/u.test(ordinal) ||
      entry?.kind !== "group"
    )
      return undefined;
    entry = entry.entries[Number(ordinal)];
  }
  return entry?.kind === "condition" ? entry : undefined;
}

export function applyRecordSearchMapping(
  node: WorkflowNode,
  path: readonly string[],
  binding: ReferenceBinding,
): boolean {
  const parsed = recordSearchDraftConfig.safeParse(node.config);
  if (!parsed.success || recordSearchBindingTarget(node.id, parsed.data, path) === undefined)
    return false;
  const key = path[0];
  if (key === "limit" || key === "offset") parsed.data[key] = binding;
  else {
    const entry = conditionAt(parsed.data.filter, path);
    if (entry === undefined) return false;
    entry.value = binding;
  }
  node.config = { ...parsed.data };
  return true;
}

export function currentRecordSearchMapping(node: WorkflowNode, path: readonly string[]): unknown {
  const parsed = recordSearchDraftConfig.safeParse(node.config);
  if (!parsed.success) return undefined;
  return recordSearchBindingEntries(parsed.data).find(
    (entry) =>
      path.length === entry.path.length && path.every((part, index) => part === entry.path[index]),
  )?.value;
}
