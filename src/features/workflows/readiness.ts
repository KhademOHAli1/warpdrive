import type { WorkflowDefinition, WorkflowNode } from "./schemas";

// Contracts can be authored before every handler exists. Publication and execution
// fail closed until an action's complete configuration has a qualified handler.
export function executableNode(node: WorkflowNode): boolean {
  if (node.type === "trigger.manual") return true;
  if (node.type === "record.read") return node.config.entity === "deal";
  if (node.type === "activity.create")
    return Object.keys(node.config).every((key) => key === "subject" || key === "dealId");
  return false;
}

export function executableDefinition(definition: WorkflowDefinition): boolean {
  return definition.nodes.every(executableNode);
}
