import { err, ok, type Result } from "@/types/result";
import { blockReferences } from "./bindings";
import type { WorkflowV2Definition, WorkflowV2Node } from "./contracts";
import { boundedBlockJson, definitionV2Schema } from "./schemas";

export function outputPorts(node: WorkflowV2Node): string[] {
  if (node.type === "ITERATOR") return ["loop", "done"];
  if (node.type === "IF_ELSE") {
    const branches = node.config.branches;
    return Array.isArray(branches)
      ? branches.flatMap((branch) =>
          branch !== null &&
          typeof branch === "object" &&
          !Array.isArray(branch) &&
          typeof branch.id === "string"
            ? [branch.id]
            : [],
        )
      : [];
  }
  return ["next"];
}
export function parseWorkflowV2Draft(raw: unknown): Result<WorkflowV2Definition, string> {
  if (!boundedBlockJson(raw)) return err("E_WORKFLOW_V2_LIMIT");
  const parsed = definitionV2Schema.safeParse(raw);
  if (!parsed.success) return err("E_WORKFLOW_V2_INVALID");
  if (JSON.stringify(parsed.data).length > 500_000) return err("E_WORKFLOW_V2_LIMIT");
  const { nodes, edges, entryNodeIds } = parsed.data;
  if (
    new Set(nodes.map((node) => node.id)).size !== nodes.length ||
    new Set(edges.map((edge) => edge.id)).size !== edges.length ||
    new Set(entryNodeIds).size !== entryNodeIds.length
  )
    return err("E_WORKFLOW_V2_DUPLICATE");
  return ok(parsed.data);
}
function incomingEdges(definition: WorkflowV2Definition): Result<Map<string, string>, string> {
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string>();
  for (const edge of definition.edges) {
    const source = nodes.get(edge.source);
    if (
      source === undefined ||
      !nodes.has(edge.target) ||
      !outputPorts(source).includes(edge.sourcePort)
    )
      return err("E_WORKFLOW_V2_EDGE");
    if (incoming.has(edge.target)) return err("E_WORKFLOW_V2_JOIN");
    incoming.set(edge.target, edge.source);
  }
  if (definition.entryNodeIds.some((id) => !nodes.has(id) || incoming.has(id)))
    return err("E_WORKFLOW_V2_ENTRY");
  return ok(incoming);
}
function reachable(definition: WorkflowV2Definition): boolean {
  const visited = new Set<string>();
  const stack = [...definition.entryNodeIds];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    stack.push(...definition.edges.filter((edge) => edge.source === id).map((edge) => edge.target));
  }
  return visited.size === definition.nodes.length;
}
function checkReferences(
  node: WorkflowV2Node,
  incoming: Map<string, string>,
): Result<true, string> {
  const ancestors = new Set<string>();
  let current = incoming.get(node.id);
  while (current !== undefined) {
    ancestors.add(current);
    current = incoming.get(current);
  }
  try {
    if (
      blockReferences(node.config).some(
        (ref) => ref.nodeId !== "$trigger" && !ancestors.has(ref.nodeId),
      )
    )
      return err("E_WORKFLOW_V2_REFERENCE");
  } catch {
    return err("E_WORKFLOW_V2_BINDING_LIMIT");
  }
  return ok(true);
}
export function validateWorkflowV2(raw: unknown): Result<WorkflowV2Definition, string> {
  const parsed = parseWorkflowV2Draft(raw);
  if (!parsed.ok) return parsed;
  const definition = parsed.value;
  const incoming = incomingEdges(definition);
  if (!incoming.ok) return incoming;
  // Single incoming edge + root entries means any cycle is unreachable.
  if (!reachable(definition)) return err("E_WORKFLOW_V2_UNREACHABLE");
  for (const node of definition.nodes) {
    if (
      node.type === "ITERATOR" &&
      !definition.edges.some((edge) => edge.source === node.id && edge.sourcePort === "loop")
    )
      return err("E_WORKFLOW_V2_ITERATOR_BODY");
    const refs = checkReferences(node, incoming.value);
    if (!refs.ok) return refs;
  }
  return parsed;
}
