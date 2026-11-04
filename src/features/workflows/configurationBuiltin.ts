import { prepareConditionConfig } from "./conditionMapping";
import { bindingOutputType, temporalConditionMismatch } from "./configurationReference";
import { configurationLimits, configurationProfiles } from "./configurationSpec";
import type {
  ConfigurationContext,
  ConfigurationIssue,
  ConfigurationIssueCode,
  ConfigurationValidation,
} from "./configurationTypes";
import { describeMappingTarget, inspectMapping } from "./mappingCatalog";
import { bindingSchema, type WorkflowNode } from "./schemas";

export function configurationIssue(
  node: WorkflowNode,
  path: readonly string[],
  code: ConfigurationIssueCode,
): ConfigurationIssue {
  return { nodeId: node.id, path, code };
}

function checkBinding(
  node: WorkflowNode,
  field: string,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  const described = describeMappingTarget(context.definition, node.id, [field], context.metadata);
  if (described.state !== "ready") {
    result.issues.push(...described.issues);
    return;
  }
  const inspected = inspectMapping(
    context.definition,
    node.id,
    described.target,
    node.config[field],
    context.metadata,
  );
  result.issues.push(...inspected.issues);
  result.runtimeChecks.push(...inspected.runtimeChecks);
}

function validateRead(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  if (node.config.entity !== "deal")
    result.issues.push(configurationIssue(node, ["entity"], "unsupported_setting"));
  checkBinding(node, "recordId", context, result);
}

function validateTask(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  checkBinding(node, "subject", context, result);
  checkBinding(node, "dealId", context, result);
  for (const field of ["assigneeId", "dueAt", "typeId"]) {
    if (Object.hasOwn(node.config, field))
      result.issues.push(configurationIssue(node, [field], "unsupported_setting"));
  }
}

function validateWait(node: WorkflowNode, result: ConfigurationValidation): void {
  if (node.config.minutes === undefined) {
    result.issues.push(configurationIssue(node, ["minutes"], "required"));
    return;
  }
  const binding = bindingSchema.safeParse(node.config.minutes);
  if (!binding.success) {
    result.issues.push(configurationIssue(node, ["minutes"], "invalid_value"));
    return;
  }
  if (binding.data.kind === "reference") {
    result.issues.push(configurationIssue(node, ["minutes"], "unsupported_setting"));
    return;
  }
  const value = binding.data.value;
  const valid =
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= configurationLimits.waitMin &&
    value <= configurationLimits.waitMax;
  if (!valid) result.issues.push(configurationIssue(node, ["minutes"], "out_of_range"));
}

function containsTypes(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  if (node.config.operator !== "contains") return;
  for (const field of ["left", "right"]) {
    const binding = bindingSchema.safeParse(node.config[field]);
    if (!binding.success) continue;
    const type = bindingOutputType(context.definition, node, binding.data);
    if (type !== "string" && type !== "decimal")
      result.issues.push(configurationIssue(node, [field], "invalid_type"));
  }
}

function validateGroupedCondition(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  const prepared = prepareConditionConfig(node.config, { ...context, nodeId: node.id });
  if (!prepared.ok) {
    result.issues.push(...prepared.error);
    return;
  }
  for (const predicate of prepared.value.predicates) {
    result.runtimeChecks.push(...predicate.left.inspection.runtimeChecks);
    if (predicate.right !== undefined)
      result.runtimeChecks.push(...predicate.right.inspection.runtimeChecks);
  }
}

function validateCondition(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  if (Object.hasOwn(node.config, "expression") || Object.hasOwn(node.config, "defaultPort")) {
    validateGroupedCondition(node, context, result);
    return;
  }
  checkBinding(node, "left", context, result);
  const operator = node.config.operator;
  const choices =
    configurationProfiles.condition.fields.find((field) => field.control === "operator")?.choices ??
    [];
  const valid = typeof operator === "string" && choices.includes(operator);
  if (!valid) result.issues.push(configurationIssue(node, ["operator"], "unsupported_setting"));
  checkBinding(node, "right", context, result);
  containsTypes(node, context, result);
  if (temporalConditionMismatch(context.definition, node))
    result.issues.push(configurationIssue(node, ["right"], "invalid_type"));
}

function allowedKeys(node: WorkflowNode): string[] {
  if (
    node.type === "condition" &&
    (Object.hasOwn(node.config, "expression") || Object.hasOwn(node.config, "defaultPort"))
  )
    return ["expression", "defaultPort"];
  const fields = configurationProfiles[node.type].fields;
  const keys = fields
    .map((field) => field.path[0])
    .filter((key): key is string => key !== undefined && key !== "name");
  if (node.type === "activity.create") keys.push("customFields");
  return keys;
}

export function validateBuiltinConfiguration(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  const allowed = allowedKeys(node);
  for (const field of Object.keys(node.config)) {
    if (!allowed.includes(field))
      result.issues.push(configurationIssue(node, [field], "unknown_setting"));
  }
  if (node.name.trim().length === 0)
    result.issues.push(configurationIssue(node, ["name"], "required"));
  if (node.name.trim().length > configurationLimits.nameMax)
    result.issues.push(configurationIssue(node, ["name"], "too_long"));
  if (node.type === "record.read") validateRead(node, context, result);
  else if (node.type === "activity.create") validateTask(node, context, result);
  else if (node.type === "condition") validateCondition(node, context, result);
  else if (node.type === "delay") validateWait(node, result);
  else if (node.type !== "trigger.manual")
    result.issues.push(configurationIssue(node, [], "unsupported_setting"));
}
