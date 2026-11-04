import { err, ok, type Result } from "@/types/result";
import { customFieldBindingSchema } from "./configurationBindings";
import { ancestors } from "./graph";
import { actionRegistry } from "./registry";
import {
  type Binding,
  bindingSchema,
  type DefinitionIssue,
  type ValueType,
  type WorkflowDefinition,
  type WorkflowNode,
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
  const outputs = actionRegistry[source.type].outputs;
  const key = binding.path.join(".");
  if (!Object.hasOwn(outputs, key)) return err("unknown_output");
  const type = outputs[key];
  return type === undefined ? err("unknown_output") : ok(type);
}

function nodeBindings(node: WorkflowNode): { field: string; binding: Binding }[] {
  const bindings: { field: string; binding: Binding }[] = [];
  for (const [field, value] of Object.entries(node.config)) {
    const parsed = bindingSchema.safeParse(value);
    if (parsed.success) bindings.push({ field, binding: parsed.data });
  }
  const custom = node.config.customFields;
  if (custom === null || typeof custom !== "object" || Array.isArray(custom)) return bindings;
  for (const [id, value] of Object.entries(custom)) {
    const parsed = customFieldBindingSchema.safeParse(value);
    if (parsed.success && parsed.data.kind === "reference")
      bindings.push({ field: `customFields.${id}`, binding: parsed.data });
  }
  return bindings;
}

function nullableLink(node: WorkflowNode, field: string, binding: Binding): boolean {
  return (
    node.type === "activity.create" &&
    field === "dealId" &&
    binding.kind === "value" &&
    binding.value === null
  );
}

export function inspectReferences(definition: WorkflowDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  for (const node of definition.nodes) {
    const available = ancestors(definition, node.id);
    for (const { field, binding } of nodeBindings(node)) {
      if (nullableLink(node, field, binding)) continue;
      const actual = bindingType(definition, available, binding);
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
