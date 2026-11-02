import type { WorkflowDefinition, WorkflowNode } from "./schemas";

function graphDependencies(definition: WorkflowDefinition) {
  const incoming = new Map(definition.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of definition.edges) {
    const count = incoming.get(edge.to);
    if (incoming.has(edge.from) && count !== undefined) {
      incoming.set(edge.to, count + 1);
      const targets = outgoing.get(edge.from) ?? [];
      targets.push(edge.to);
      outgoing.set(edge.from, targets);
    }
  }
  return { incoming, outgoing };
}

export function orderedWorkflowNodes(definition: WorkflowDefinition): WorkflowNode[] {
  const { incoming, outgoing } = graphDependencies(definition);
  if (incoming.size !== definition.nodes.length) return definition.nodes;
  const remaining = new Set(incoming.keys());
  const ordered: WorkflowNode[] = [];
  // Display dependencies first; creation priority breaks ties between eligible nodes.
  while (remaining.size > 0) {
    const next = definition.nodes.find(
      (node) => remaining.has(node.id) && incoming.get(node.id) === 0,
    );
    if (next === undefined) break;
    remaining.delete(next.id);
    ordered.push(next);
    for (const target of outgoing.get(next.id) ?? []) {
      incoming.set(target, (incoming.get(target) ?? 0) - 1);
    }
  }
  // Retain unresolved draft cycles so their nodes remain available for correction.
  return [...ordered, ...definition.nodes.filter((node) => remaining.has(node.id))];
}
