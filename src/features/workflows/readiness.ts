import { parseConditionConfig } from "./conditionExpression";
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
    const selected = Object.hasOwn(node.config, "until") ? "until" : "minutes";
    const binding = bindingSchema.safeParse(node.config[selected]);
    return (
      binding.success &&
      binding.data.kind === "value" &&
      actionRegistry.delay.config.safeParse(node.config).success
    );
  }
  if (node.type === "condition") {
    if (Object.hasOwn(node.config, "expression") || Object.hasOwn(node.config, "defaultPort")) {
      const grouped = parseConditionConfig(node.config, "execute");
      return grouped.ok && grouped.value.kind === "grouped";
    }
    return (
      typeof node.config.operator === "string" &&
      ["exists", "equals", "notEquals", "contains"].includes(node.config.operator)
    );
  }
  if (node.type === "record.read") return node.config.entity === "deal";
  if (node.type === "activity.create")
    return Object.keys(node.config).every(
      (key) => key === "subject" || key === "dealId" || key === "customFields",
    );
  return false;
}

export function executableDefinition(definition: WorkflowDefinition): boolean {
  return isSupportedVersion(definition.schemaVersion) && definition.nodes.every(executableNode);
}

// Draft simulation intentionally has a narrower wait contract than published
// execution. Fixed-instant waits remain executable after publication, but the
// draft transaction only projects bounded duration waits and must never route an
// `until` binding through delayResumeAt as if it were a `minutes` binding.
export function draftExecutableNode(node: WorkflowNode): boolean {
  if (!executableNode(node)) return false;
  if (node.type !== "delay") return true;
  return (
    !Object.hasOwn(node.config, "until") &&
    Object.keys(node.config).every((key) => key === "minutes")
  );
}

export function draftExecutableDefinition(definition: WorkflowDefinition): boolean {
  return (
    isSupportedVersion(definition.schemaVersion) && definition.nodes.every(draftExecutableNode)
  );
}
