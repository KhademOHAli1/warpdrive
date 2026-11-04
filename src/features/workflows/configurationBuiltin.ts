import { z } from "zod";
import {
  bindingOutputType,
  compatibleBuiltinOutput,
  configurationOutput,
} from "./configurationReference";
import { configurationLimits, configurationProfiles } from "./configurationSpec";
import type {
  ConfigurationContext,
  ConfigurationIssue,
  ConfigurationIssueCode,
  ConfigurationValidation,
} from "./configurationTypes";
import { bindingSchema, type WorkflowNode } from "./schemas";

interface BindingRule {
  expected: "string" | "deal" | "number" | "scalar";
  required?: boolean;
  nullable?: boolean;
  nonblank?: boolean;
  max?: number;
}

function bindingRule(node: WorkflowNode, key: string): BindingRule {
  const field = configurationProfiles[node.type].fields.find((entry) => entry.path[0] === key);
  const expected = field?.valueType;
  const kind = expected === "deal" || expected === "scalar" ? expected : "string";
  const conditional = field?.requiredWhen;
  const required =
    conditional === undefined
      ? field?.required
      : node.config[conditional.field] !== conditional.not;
  return {
    expected: kind,
    required,
    nullable: field?.nullable,
    nonblank: field?.constraints?.trim,
    max: field?.constraints?.maxLength,
  };
}

export function configurationIssue(
  node: WorkflowNode,
  path: readonly string[],
  code: ConfigurationIssueCode,
): ConfigurationIssue {
  return { nodeId: node.id, path, code };
}

function literalProblem(value: unknown, rule: BindingRule): ConfigurationIssueCode | null {
  if (value === null) return rule.nullable === true ? null : "invalid_type";
  if (rule.expected === "deal")
    return z.string().uuid().safeParse(value).success ? null : "invalid_value";
  if (rule.expected !== "scalar" && typeof value !== rule.expected) return "invalid_type";
  if (typeof value !== "string") return null;
  if (rule.nonblank === true && value.trim().length === 0) return "required";
  if (rule.max !== undefined && value.length > rule.max) return "too_long";
  return null;
}

function checkBinding(
  node: WorkflowNode,
  field: string,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  const rule = bindingRule(node, field);
  const raw = node.config[field];
  if (raw === undefined) {
    if (rule.required === true) result.issues.push(configurationIssue(node, [field], "required"));
    return;
  }
  const parsed = bindingSchema.safeParse(raw);
  if (!parsed.success) {
    result.issues.push(configurationIssue(node, [field], "invalid_value"));
    return;
  }
  const binding = parsed.data;
  if (binding.kind === "value") {
    const code = literalProblem(binding.value, rule);
    if (code !== null) result.issues.push(configurationIssue(node, [field], code));
    if (code === null && rule.expected === "deal" && binding.value !== null)
      result.runtimeChecks.push([field]);
    return;
  }
  const output = configurationOutput(context.definition, node.id, binding);
  const code =
    output === null
      ? "reference_missing"
      : compatibleBuiltinOutput(rule.expected, output)
        ? null
        : "reference_incompatible";
  if (code === null) result.runtimeChecks.push([field]);
  else result.issues.push(configurationIssue(node, [field], code));
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

function validateCondition(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  checkBinding(node, "left", context, result);
  const operator = node.config.operator;
  const choices =
    configurationProfiles.condition.fields.find((field) => field.control === "operator")?.choices ??
    [];
  const valid = typeof operator === "string" && choices.includes(operator);
  if (!valid) result.issues.push(configurationIssue(node, ["operator"], "unsupported_setting"));
  checkBinding(node, "right", context, result);
  containsTypes(node, context, result);
}

function allowedKeys(node: WorkflowNode): string[] {
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
