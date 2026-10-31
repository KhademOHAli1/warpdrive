import { err, ok, type Result } from "@/types/result";
import { ancestors } from "./graph";
import { actionRegistry } from "./registry";
import {
  type Binding,
  bindingSchema,
  type DefinitionIssue,
  type ValueType,
  type WorkflowDefinition,
} from "./schemas";

function bindingType(
  definition: WorkflowDefinition,
  available: Set<string>,
  binding: Binding,
): Result<ValueType | undefined, string> {
  if (binding.kind === "value")
    return ok(binding.value === null ? undefined : (typeof binding.value as ValueType));
  const source = definition.nodes.find((node) => node.id === binding.nodeId);
  if (!available.has(binding.nodeId) || source === undefined) return err("unavailable_reference");
  const type = actionRegistry[source.type].outputs[binding.path.join(".")];
  return type === undefined ? err("unknown_output") : ok(type);
}

export function inspectReferences(definition: WorkflowDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  for (const node of definition.nodes) {
    const available = ancestors(definition, node.id);
    for (const [field, value] of Object.entries(node.config)) {
      const parsed = bindingSchema.safeParse(value);
      if (!parsed.success) continue;
      const actual = bindingType(definition, available, parsed.data);
      if (!actual.ok) {
        issues.push({ code: actual.error, nodeId: node.id, field });
        continue;
      }
      const expected = actionRegistry[node.type].inputs[field];
      if (expected !== undefined && expected !== actual.value)
        issues.push({ code: "type_mismatch", nodeId: node.id, field });
    }
  }
  return issues;
}
