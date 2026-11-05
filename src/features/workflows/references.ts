import { prepareConditionConfig } from "./conditionMapping";
import { customFieldBindingSchema } from "./configurationBindings";
import { conditionContainsMismatch, temporalConditionMismatch } from "./configurationReference";
import { mappingPathNodes } from "./mappingAvailability";
import { describeMappingTarget, inspectMapping, mappingOutputForReference } from "./mappingCatalog";
import { actionRegistry } from "./registry";
import {
  type Binding,
  bindingSchema,
  type DefinitionIssue,
  type WorkflowDefinition,
  type WorkflowNode,
} from "./schemas";

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

function structuralReferenceIssue(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  binding: Extract<Binding, { kind: "reference" }>,
): string | null {
  const path = mappingPathNodes(definition, node.id);
  if (!path.nodes.some((entry) => entry.id === binding.nodeId)) return "unavailable_reference";
  const source = definition.nodes.find((entry) => entry.id === binding.nodeId);
  if (source === undefined) return "unavailable_reference";
  const key = binding.path.join(".");
  return Object.hasOwn(actionRegistry[source.type].outputs, key) ? null : "unknown_output";
}

function bindingIssue(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  field: string,
  binding: Binding,
): string | null {
  if (binding.kind === "reference") {
    const structural = structuralReferenceIssue(definition, node, binding);
    if (structural !== null) return structural;
    // Unsupported nominal handlers remain the separate NOT_READY gate. They are
    // never offered by the catalog or interpreted as qualified runtime values.
    if (mappingOutputForReference(definition, binding) === undefined) return null;
  }
  if (field.startsWith("customFields.")) return null; // Complete metadata owns target validation.
  const target = describeMappingTarget(definition, node.id, [field]);
  if (target.state !== "ready") return null;
  const inspected = inspectMapping(definition, node.id, target.target, binding);
  return inspected.compatibility === "incompatible" ? "type_mismatch" : null;
}

function groupedReferenceIssues(
  definition: WorkflowDefinition,
  node: WorkflowNode,
): DefinitionIssue[] | null {
  if (
    (node.type !== "condition" && node.type !== "filter") ||
    (!Object.hasOwn(node.config, "expression") && !Object.hasOwn(node.config, "defaultPort"))
  )
    return null;
  const prepared = prepareConditionConfig(node.config, { definition, nodeId: node.id });
  if (prepared.ok) return [];
  return prepared.error
    .filter((issue) => issue.code !== "unsupported_setting")
    .map((issue) => ({
      code: issue.code,
      nodeId: node.id,
      field: issue.path.join("."),
      path: issue.path,
    }));
}

export function inspectReferences(definition: WorkflowDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  for (const node of definition.nodes) {
    const grouped = groupedReferenceIssues(definition, node);
    if (grouped !== null) {
      issues.push(...grouped);
      continue;
    }
    for (const { field, binding } of nodeBindings(node)) {
      const code = bindingIssue(definition, node, field, binding);
      if (code !== null) issues.push({ code, nodeId: node.id, field });
    }
    if (temporalConditionMismatch(definition, node) || conditionContainsMismatch(definition, node))
      issues.push({ code: "type_mismatch", nodeId: node.id, field: "right" });
  }
  return issues;
}
