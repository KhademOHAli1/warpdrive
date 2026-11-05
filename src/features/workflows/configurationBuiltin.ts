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
import {
  workflowCalendarEventConfig,
  workflowCalendarEventFields,
} from "./workflowCalendarEventContract";
import { workflowEmailDraftConfig, workflowEmailDraftFields } from "./workflowEmailDraftContract";
import { recordCreateConfig } from "./workflowRecordCreateContract";
import { recordDeleteConfig, recordUpdateConfig } from "./workflowRecordMutationContract";
import {
  recordPickConfig,
  recordSearchBindingEntries,
  recordSearchConfig,
} from "./workflowRecordQueryContract";

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

function appendSchemaIssues(
  node: WorkflowNode,
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  result: ConfigurationValidation,
) {
  for (const issue of issues) {
    const path = issue.path.map(String);
    const message = issue.message;
    const key = path[0];
    const code =
      message === "required" || message === "out_of_range" || message === "unknown_setting"
        ? message
        : path.length === 1 && key !== undefined && node.config[key] === undefined
          ? "required"
          : "invalid_value";
    result.issues.push(configurationIssue(node, path, code));
  }
}

function validateRecordDelete(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
) {
  const parsed = recordDeleteConfig.safeParse(node.config);
  if (!parsed.success) return appendSchemaIssues(node, parsed.error.issues, result);
  checkMapping(node, ["recordId"], parsed.data.recordId, context, result);
}

function validateRecordUpdate(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
) {
  const parsed = recordUpdateConfig.safeParse(node.config);
  if (!parsed.success) return appendSchemaIssues(node, parsed.error.issues, result);
  checkMapping(node, ["recordId"], parsed.data.recordId, context, result);
  for (const [key, value] of Object.entries(parsed.data.fields))
    checkMapping(node, ["fields", key], value, context, result);
}

function validateRecordSearch(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
) {
  const search = recordSearchConfig.safeParse(node.config);
  if (!search.success) return appendSchemaIssues(node, search.error.issues, result);
  for (const { path, value } of recordSearchBindingEntries(search.data))
    checkMapping(node, path, value, context, result);
}

function validateRecordPick(
  node: WorkflowNode,
  _context: ConfigurationContext,
  result: ConfigurationValidation,
) {
  const pick = recordPickConfig.safeParse(node.config);
  if (!pick.success) appendSchemaIssues(node, pick.error.issues, result);
}

function validateEmailDraft(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
) {
  const parsed = workflowEmailDraftConfig.safeParse(node.config);
  if (!parsed.success) return appendSchemaIssues(node, parsed.error.issues, result);
  for (const { key } of workflowEmailDraftFields)
    if (node.config[key] !== undefined) checkBinding(node, key, context, result);
}

function validateCalendarEvent(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
) {
  const parsed = workflowCalendarEventConfig.safeParse(node.config);
  if (!parsed.success) return appendSchemaIssues(node, parsed.error.issues, result);
  for (const { key } of workflowCalendarEventFields)
    if (node.config[key] !== undefined) checkBinding(node, key, context, result);
}

function validateIfElse(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
) {
  const checked = prepareIfElseConfig(node.config, {
    definition: context.definition,
    nodeId: node.id,
  });
  if (!checked.ok) result.issues.push(...checked.error);
}

const validators: Partial<Record<WorkflowNode["type"], typeof validateRead>> = {
  "record.read": validateRead,
  "activity.create": validateTask,
  "record.create": validateRecordCreate,
  "record.update": validateRecordUpdate,
  "record.delete": validateRecordDelete,
  "record.search": validateRecordSearch,
  "record.pick": validateRecordPick,
  "email.draft": validateEmailDraft,
  "calendar.create": validateCalendarEvent,
  ifElse: validateIfElse,
  condition: validateCondition,
  filter: validateCondition,
  delay: validateWait,
};

const fixedKeys: Partial<Record<WorkflowNode["type"], string[]>> = {
  ifElse: ["branches", "fallbackId"],
  "record.create": ["entity", "fields"],
  "record.update": ["entity", "recordId", "fields"],
  "record.delete": ["entity", "recordId"],
  "record.search": ["entity", "filter", "orderBy", "limit", "offset"],
  "record.pick": ["entity", "strategy", "recordIds", "loadBalance"],
  "email.draft": ["accountId", ...workflowEmailDraftFields.map(({ key }) => key)],
  "calendar.create": ["allDay", "timeZone", ...workflowCalendarEventFields.map(({ key }) => key)],
};

function allowedKeys(node: WorkflowNode): string[] {
  const fixed = fixedKeys[node.type];
  if (fixed !== undefined) return fixed;
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
  const validate = validators[node.type];
  if (validate !== undefined) validate(node, context, result);
  else if (node.type !== "trigger.manual")
    result.issues.push(configurationIssue(node, [], "unsupported_setting"));
}
