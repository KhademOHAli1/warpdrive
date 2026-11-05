import { parseConditionConfig } from "./conditionExpression";
import { actionRegistry } from "./registry";
import { bindingSchema, type WorkflowDefinition, type WorkflowNode } from "./schemas";
import { workflowIteratorGraphReady } from "./workflowIteratorGraph";

// ORM JSON types do not validate stored values at runtime.
// Keep this boundary check strict without relying on the declared literal version types.
function isSupportedVersion(value: unknown): boolean {
  return value === 1;
}

function executableDelay(node: WorkflowNode): boolean {
  if (Object.hasOwn(node.config, "delayType"))
    return actionRegistry.delay.config.safeParse(node.config).success;
  const selected = Object.hasOwn(node.config, "until") ? "until" : "minutes";
  const binding = bindingSchema.safeParse(node.config[selected]);
  return (
    binding.success &&
    binding.data.kind === "value" &&
    actionRegistry.delay.config.safeParse(node.config).success
  );
}

// Contracts can be authored before every handler exists. Publication and execution
// fail closed until an action's complete configuration has a qualified handler.
export function executableNode(node: WorkflowNode): boolean {
  if (!isSupportedVersion(node.version)) return false;
  if (node.type === "trigger.manual")
    return actionRegistry["trigger.manual"].config.safeParse(node.config).success;
  if (node.type === "trigger.schedule")
    return actionRegistry[node.type].config.safeParse(node.config).success;
  if (node.type === "delay") return executableDelay(node);
  if (
    [
      "ifElse",
      "iterator",
      "record.create",
      "record.update",
      "record.delete",
      "record.search",
      "record.upsert",
      "record.pick",
      "email.draft",
      "calendar.create",
      "human.form",
    ].includes(node.type)
  )
    return actionRegistry[node.type].config.safeParse(node.config).success;
  if (node.type === "condition" || node.type === "filter") {
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
  return (
    isSupportedVersion(definition.schemaVersion) &&
    definition.nodes.every(executableNode) &&
    workflowIteratorGraphReady(definition)
  );
}

// Legacy fixed instants retain their existing published-only contract. The
// configured schedules share the same deadline projection in both modes.
export function draftExecutableNode(node: WorkflowNode): boolean {
  if (node.type === "human.form" || node.type === "trigger.schedule" || !executableNode(node))
    return false;
  if (node.type !== "delay") return true;
  if (Object.hasOwn(node.config, "delayType")) return true;
  return (
    !Object.hasOwn(node.config, "until") &&
    Object.keys(node.config).every((key) => key === "minutes")
  );
}

export function requiresHumanForm(definition: WorkflowDefinition): boolean {
  return definition.nodes.some((node) => node.type === "human.form");
}

export function draftExecutableDefinition(definition: WorkflowDefinition): boolean {
  return (
    isSupportedVersion(definition.schemaVersion) &&
    definition.nodes.every(draftExecutableNode) &&
    workflowIteratorGraphReady(definition)
  );
}
