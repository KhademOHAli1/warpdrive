import { z } from "zod";
import { buildCustomFieldsSchema, valueSchemaFor } from "@/features/custom-fields/validate";
import type { CustomFieldDef } from "@/types/customFields";
import {
  type CustomFieldBinding,
  customFieldBindingSchema,
  customLiteralKeysAllowed,
} from "./configurationBindings";
import { configurationIssue } from "./configurationBuiltin";
import type {
  ConfigurationContext,
  ConfigurationIssueCode,
  ConfigurationValidation,
} from "./configurationTypes";
import { describeMappingTarget, inspectMapping } from "./mappingCatalog";
import type { WorkflowNode } from "./schemas";

function objectMap(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

function valueCode(def: CustomFieldDef, code: string): ConfigurationIssueCode {
  if (def.type === "single_option" || def.type === "multi_option") return "option_unavailable";
  if (code === "invalid_type") return "invalid_type";
  if (code === "too_big") return "too_long";
  return "invalid_value";
}

function literalIssues(
  node: WorkflowNode,
  def: CustomFieldDef,
  binding: Extract<CustomFieldBinding, { kind: "value" }>,
  result: ConfigurationValidation,
): void {
  if (!customLiteralKeysAllowed(def.type, binding.value)) {
    result.issues.push(configurationIssue(node, ["customFields", def.id], "invalid_value"));
    return;
  }
  const parsed = valueSchemaFor(def).safeParse(binding.value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = ["customFields", def.id, "value", ...issue.path.map(String)];
      result.issues.push(configurationIssue(node, path, valueCode(def, issue.code)));
    }
    return;
  }
  // Reuse the canonical required-value refinement after base validation; no dummy
  // values are substituted for unresolved references.
  const required = buildCustomFieldsSchema([def]).safeParse({ [def.key]: binding.value });
  if (!required.success)
    result.issues.push(configurationIssue(node, ["customFields", def.id], "required"));
  if (["user", "person", "org"].includes(def.type))
    result.runtimeChecks.push(["customFields", def.id]);
}

function validateFieldBinding(
  node: WorkflowNode,
  def: CustomFieldDef,
  raw: unknown,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  const path = ["customFields", def.id];
  const parsed = customFieldBindingSchema.safeParse(raw);
  if (!parsed.success) {
    result.issues.push(configurationIssue(node, path, "invalid_value"));
    return;
  }
  if (parsed.data.kind === "value") {
    literalIssues(node, def, parsed.data, result);
    return;
  }
  const target = describeMappingTarget(context.definition, node.id, path, context.metadata);
  if (target.state !== "ready") {
    result.issues.push(...target.issues);
    return;
  }
  const inspected = inspectMapping(
    context.definition,
    node.id,
    target.target,
    parsed.data,
    context.metadata,
  );
  result.issues.push(...inspected.issues);
  result.runtimeChecks.push(...inspected.runtimeChecks);
}

function validateKnownField(
  node: WorkflowNode,
  def: CustomFieldDef,
  settings: Record<string, unknown>,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  if (def.targetEntity !== "activity") return;
  const present = Object.hasOwn(settings, def.id);
  if (def.archivedAt !== null) {
    if (present)
      result.issues.push(configurationIssue(node, ["customFields", def.id], "field_archived"));
    return;
  }
  if (present) validateFieldBinding(node, def, settings[def.id], context, result);
  else if (!buildCustomFieldsSchema([def]).safeParse({}).success)
    result.issues.push(configurationIssue(node, ["customFields", def.id], "required"));
}

function validateSettingIdentities(
  node: WorkflowNode,
  settings: Record<string, unknown>,
  defs: readonly CustomFieldDef[],
  complete: boolean,
  result: ConfigurationValidation,
): void {
  for (const [id, value] of Object.entries(settings)) {
    const validId = z.string().uuid().safeParse(id).success && id === id.toLowerCase();
    if (!validId)
      result.issues.push(configurationIssue(node, ["customFields", id], "unknown_field"));
    const known = defs.some((def) => def.id === id && def.targetEntity === "activity");
    if (validId && complete && !known)
      result.issues.push(configurationIssue(node, ["customFields", id], "unknown_field"));
    if (!customFieldBindingSchema.safeParse(value).success)
      result.issues.push(configurationIssue(node, ["customFields", id], "invalid_value"));
  }
}

export function validateCustomConfiguration(
  node: WorkflowNode,
  context: ConfigurationContext,
  result: ConfigurationValidation,
): void {
  const complete = context.metadata?.status === "complete";
  if (!complete) {
    const code = context.metadata?.status === "stale" ? "metadata_stale" : "metadata_incomplete";
    result.issues.push(configurationIssue(node, ["customFields"], code));
  }
  const raw = node.config.customFields;
  if (raw !== undefined && !objectMap(raw)) {
    result.issues.push(configurationIssue(node, ["customFields"], "invalid_type"));
    return;
  }
  const settings = raw ?? {};
  const defs = context.metadata?.defs ?? [];
  validateSettingIdentities(node, settings, defs, complete, result);
  for (const def of defs) validateKnownField(node, def, settings, context, result);
}
