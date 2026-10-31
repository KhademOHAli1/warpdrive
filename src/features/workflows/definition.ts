import { err, ok, type Result } from "@/types/result";
import { inspectGraph } from "./graph";
import { inspectReferences } from "./references";
import { actionRegistry } from "./registry";
import { type DefinitionIssue, definitionSchema, type WorkflowDefinition } from "./schemas";

export function validateDefinition(raw: unknown): Result<WorkflowDefinition, DefinitionIssue[]> {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) return err([{ code: "invalid_definition" }]);
  const definition = parsed.data;
  const issues = inspectGraph(definition);
  for (const node of definition.nodes) {
    if (!actionRegistry[node.type].config.safeParse(node.config).success)
      issues.push({ code: "invalid_definition", nodeId: node.id });
  }
  issues.push(...inspectReferences(definition));
  return issues.length === 0 ? ok(definition) : err(issues);
}
