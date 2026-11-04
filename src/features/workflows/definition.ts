import { err, ok, type Result } from "@/types/result";
import type { ConfigurationMetadata } from "./configurationTypes";
import { validateWorkflowConfiguration } from "./configurationValidation";
import { inspectGraph } from "./graph";
import { inspectReferences } from "./references";
import { actionRegistry } from "./registry";
import { type DefinitionIssue, definitionSchema, type WorkflowDefinition } from "./schemas";

export function validateDefinition(
  raw: unknown,
  metadata?: ConfigurationMetadata,
): Result<WorkflowDefinition, DefinitionIssue[]> {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) return err([{ code: "invalid_definition" }]);
  const definition = parsed.data;
  const issues = inspectGraph(definition);
  for (const node of definition.nodes) {
    if (!actionRegistry[node.type].config.safeParse(node.config).success)
      issues.push({ code: "invalid_definition", nodeId: node.id });
  }
  issues.push(...inspectReferences(definition));
  if (metadata !== undefined) {
    const checked = validateWorkflowConfiguration(definition, { definition, metadata });
    // Handler support remains the separate readiness gate and NOT_READY result.
    issues.push(
      ...checked.issues
        .filter((issue) => issue.code !== "unsupported_setting")
        .map((issue) => ({
          code: issue.code,
          nodeId: issue.nodeId,
          field: issue.path.join("."),
          path: issue.path,
        })),
    );
  }
  return issues.length === 0 ? ok(definition) : err(issues);
}
