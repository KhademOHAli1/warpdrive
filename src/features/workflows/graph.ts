import type { DefinitionIssue, WorkflowDefinition } from "./schemas";

function inspectEdges(definition: WorkflowDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  for (const edge of definition.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) issues.push({ code: "missing_node" });
    const source = nodes.get(edge.from);
    if (
      source !== undefined &&
      (source.type === "condition" ? edge.port === "next" : edge.port !== "next")
    )
      issues.push({ code: "invalid_port", nodeId: edge.from });
  }
  return issues;
}

function inspectPorts(definition: WorkflowDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  for (const node of definition.nodes) {
    const incoming = definition.edges.filter((edge) => edge.to === node.id);
    const outgoing = definition.edges.filter((edge) => edge.from === node.id);
    if (incoming.length > 1 || (node.type.startsWith("trigger.") && incoming.length > 0))
      issues.push({ code: "invalid_incoming", nodeId: node.id });
    const ports = new Set(outgoing.map((edge) => edge.port));
    if (ports.size !== outgoing.length) issues.push({ code: "duplicate_port", nodeId: node.id });
    if (node.type === "condition" && (!ports.has("true") || !ports.has("false")))
      issues.push({ code: "incomplete_branch", nodeId: node.id });
  }
  return issues;
}

export function inspectGraph(definition: WorkflowDefinition): DefinitionIssue[] {
  const issues = [...inspectEdges(definition), ...inspectPorts(definition)];
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  if (nodes.size !== definition.nodes.length) issues.push({ code: "duplicate_node" });
  const triggers = definition.nodes.filter((node) => node.type.startsWith("trigger."));
  if (triggers.length !== 1) issues.push({ code: "entry_trigger" });
  const visited = new Set<string>();
  const active = new Set<string>();
  function visit(id: string): void {
    if (active.has(id)) {
      issues.push({ code: "cycle", nodeId: id });
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    active.add(id);
    for (const edge of definition.edges.filter((item) => item.from === id)) visit(edge.to);
    active.delete(id);
  }
  const trigger = triggers[0];
  if (trigger !== undefined) visit(trigger.id);
  for (const node of definition.nodes)
    if (!visited.has(node.id)) issues.push({ code: "unreachable", nodeId: node.id });
  return issues;
}

export function ancestors(definition: WorkflowDefinition, nodeId: string): Set<string> {
  const result = new Set<string>();
  let current = nodeId;
  for (let count = 0; count < definition.nodes.length; count++) {
    const edge = definition.edges.find((item) => item.to === current);
    if (edge === undefined || result.has(edge.from)) break;
    result.add(edge.from);
    current = edge.from;
  }
  return result;
}
