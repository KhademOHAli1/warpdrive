import { ifElsePorts } from "./ifElseBudget";
import type { WorkflowEdge, WorkflowNode } from "./schemas";

export function portsFor(node: WorkflowNode): WorkflowEdge["port"][] {
  if (node.type === "condition") return ["true", "false"];
  if (node.type === "iterator") return ["loop", "done"];
  if (node.type === "ifElse") return ifElsePorts(node.config);
  return ["next"];
}
