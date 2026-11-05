import { prepareConditionConfig } from "./conditionMapping";
import { bindingOutputType, temporalConditionMismatch } from "./configurationReference";
import { configurationLimits, configurationProfiles } from "./configurationSpec";
import type {
  ConfigurationContext,
  ConfigurationIssue,
  ConfigurationIssueCode,
  ConfigurationValidation,
} from "./configurationTypes";
import { boundedDelayConfig, delayDurationUnits, delayUntilDate } from "./delayConfig";
import { prepareIfElseConfig } from "./ifElse";
import { describeMappingTarget, inspectMapping } from "./mappingCatalog";
import { delayScheduleConfigSchema } from "./registry";
import { bindingSchema, draftBindingSchema, type WorkflowNode } from "./schemas";
import { recordCreateConfig } from "./workflowRecordCreateContract";

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
  checkMapping(node, [field], node.config[field], context, result);
}

function checkMapping(
  node: WorkflowNode,
  path: readonly string[],
  raw: unknown,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  const described = describeMappingTarget(context.definition, node.id, path, context.metadata);
  if (described.state !== "ready") {
    result.issues.push(...described.issues);
    return;
  }
  const inspected = inspectMapping(
    context.definition,
    node.id,
    described.target,
    raw,
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

function validateUntil(node: WorkflowNode, result: ConfigurationValidation): void {
  if (!boundedDelayConfig(node.config)) {
    result.issues.push(configurationIssue(node, ["until"], "invalid_value"));
    return;
  }
  const raw = node.config.until;
  if (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    raw.kind !== "reference" &&
    !Object.hasOwn(raw, "value")
  ) {
    result.issues.push(configurationIssue(node, ["until"], "required"));
    return;
  }
  const binding = draftBindingSchema.safeParse(raw);
  if (!binding.success) {
    result.issues.push(configurationIssue(node, ["until"], "invalid_value"));
    return;
  }
  if (binding.data.kind === "reference") {
    result.issues.push(configurationIssue(node, ["until"], "unsupported_setting"));
    return;
  }
  if (binding.data.literalType !== "instant") {
    result.issues.push(configurationIssue(node, ["until"], "invalid_type"));
    return;
  }
  if (delayUntilDate(binding.data.value) === null)
    result.issues.push(configurationIssue(node, ["until"], "literal_instant_invalid"));
}

function validateDelaySchedule(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  const parsed = delayScheduleConfigSchema.safeParse(node.config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.filter((key): key is string => typeof key === "string");
      let code: ConfigurationIssueCode = "invalid_value";
      if (issue.message === "out_of_range" || issue.message === "literal_instant_invalid")
        code = issue.message;
      else if (path.length === 1 && path[0] !== undefined && node.config[path[0]] === undefined)
        code = "required";
      result.issues.push(configurationIssue(node, path, code));
    }
    return;
  }
  const settings = parsed.data;
  if (settings.delayType === "SCHEDULED_DATE") {
    checkBinding(node, "scheduledDateTime", context, result);
    return;
  }
  for (const unit of delayDurationUnits) {
    const binding = settings.duration[unit];
    if (binding?.kind === "reference")
      checkMapping(node, ["duration", unit], binding, context, result);
  }
}

function validateWait(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  if (Object.hasOwn(node.config, "delayType")) {
    validateDelaySchedule(node, context, result);
    return;
  }
  if (Object.hasOwn(node.config, "until")) {
    validateUntil(node, result);
    return;
  }
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

function validateRecordCreate(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
) {
  const parsed = recordCreateConfig.safeParse(node.config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String);
      const code =
        issue.message === "required" || issue.message === "unknown_setting"
          ? issue.message
          : "invalid_value";
      result.issues.push(configurationIssue(node, path, code));
    }
    return;
  }
  for (const [key, binding] of Object.entries(parsed.data.fields))
    checkMapping(node, ["fields", key], binding, context, result);
}

function allowedKeys(node: WorkflowNode): string[] {
  if (node.type === "ifElse") return ["branches", "fallbackId"];
  if (node.type === "record.create") return ["entity", "fields"];
  if (node.type === "delay" && Object.hasOwn(node.config, "delayType"))
    return ["delayType", node.config.delayType === "DURATION" ? "duration" : "scheduledDateTime"];
  if (
    (node.type === "condition" || node.type === "filter") &&
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
  else if (node.type === "record.create") validateRecordCreate(node, context, result);
  else if (node.type === "ifElse") {
    const checked = prepareIfElseConfig(node.config, {
      definition: context.definition,
      nodeId: node.id,
    });
    if (!checked.ok) result.issues.push(...checked.error);
  } else if (node.type === "condition" || node.type === "filter")
    validateCondition(node, context, result);
  else if (node.type === "delay") validateWait(node, context, result);
  else if (node.type !== "trigger.manual")
    result.issues.push(configurationIssue(node, [], "unsupported_setting"));
}
