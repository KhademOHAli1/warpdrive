import { actionRegistry } from "./registry";
import { bindingSchema, type WorkflowDefinition, type WorkflowNode } from "./schemas";

// ORM JSON types do not validate stored values at runtime.
// Keep this boundary check strict without relying on the declared literal version types.
function isSupportedVersion(value: unknown): boolean {
  return value === 1;
}

// Contracts can be authored before every handler exists. Publication and execution
// fail closed until an action's complete configuration has a qualified handler.
export function executableNode(node: WorkflowNode): boolean {
  if (!isSupportedVersion(node.version)) return false;
  if (node.type === "trigger.manual") return true;
  if (node.type === "delay") {
    const minutes = bindingSchema.safeParse(node.config.minutes);
    return (
      minutes.success &&
      minutes.data.kind === "value" &&
      actionRegistry.delay.config.safeParse(node.config).success
    );
  }
  if (node.type === "condition")
    return (
      typeof node.config.operator === "string" &&
      ["exists", "equals", "notEquals", "contains"].includes(node.config.operator)
    );
  if (node.type === "record.read") return node.config.entity === "deal";
  if (node.type === "activity.create")
    return Object.keys(node.config).every((key) => key === "subject" || key === "dealId");
  return false;
}

export function executableDefinition(definition: WorkflowDefinition): boolean {
  return isSupportedVersion(definition.schemaVersion) && definition.nodes.every(executableNode);
}
