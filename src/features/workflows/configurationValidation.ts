import { validateBuiltinConfiguration } from "./configurationBuiltin";
import { validateCustomConfiguration } from "./configurationCustomFields";
import { getConfigurationSpec } from "./configurationSpec";
import type { ConfigurationContext, ConfigurationValidation } from "./configurationTypes";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

function finish(result: ConfigurationValidation): ConfigurationValidation {
  const invalid = result.issues.some(
    (issue) => issue.code !== "metadata_incomplete" && issue.code !== "metadata_stale",
  );
  if (invalid) result.status = "invalid";
  else if (result.issues.length > 0) result.status = "incomplete-metadata";
  return result;
}

export function validateNodeConfiguration(
  node: WorkflowNode,
  context: ConfigurationContext,
): ConfigurationValidation {
  const result: ConfigurationValidation = { status: "valid", issues: [], runtimeChecks: [] };
  const spec = getConfigurationSpec(node.type, node.version, context.metadata);
  if (spec === null)
    return {
      status: "invalid",
      issues: [{ nodeId: node.id, path: [], code: "unsupported_setting" }],
      runtimeChecks: [],
    };
  validateBuiltinConfiguration(node, context, result);
  if (node.type === "activity.create") validateCustomConfiguration(node, context, result);
  return finish(result);
}

export function validateWorkflowConfiguration(
  definition: WorkflowDefinition,
  context: ConfigurationContext,
): ConfigurationValidation {
  const result: ConfigurationValidation = { status: "valid", issues: [], runtimeChecks: [] };
  const current = { ...context, definition };
  for (const node of definition.nodes) {
    const checked = validateNodeConfiguration(node, current);
    result.issues.push(...checked.issues);
    result.runtimeChecks.push(...checked.runtimeChecks);
  }
  return finish(result);
}
