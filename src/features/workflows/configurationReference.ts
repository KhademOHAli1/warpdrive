import type { CustomFieldType } from "@/constants/customFieldTypes";
import type { CustomFieldDef } from "@/types/customFields";
import { ancestors } from "./graph";
import { actionRegistry } from "./registry";
import type { Binding, ValueType, WorkflowDefinition, WorkflowNode } from "./schemas";

export interface ConfigurationOutput {
  type: ValueType;
  semantic: "deal" | "scalar";
}

export function configurationOutput(
  definition: WorkflowDefinition,
  nodeId: string,
  binding: Extract<Binding, { kind: "reference" }>,
): ConfigurationOutput | null {
  if (!ancestors(definition, nodeId).has(binding.nodeId)) return null;
  const source = definition.nodes.find((node) => node.id === binding.nodeId);
  if (source === undefined) return null;
  const key = binding.path.join(".");
  const outputs = actionRegistry[source.type].outputs;
  if (!Object.hasOwn(outputs, key)) return null;
  const type = outputs[key];
  if (type === undefined) return null;
  const manual = source.type === "trigger.manual" && key === "recordId";
  const read = source.type === "record.read" && source.config.entity === "deal" && key === "id";
  return { type, semantic: manual || read ? "deal" : "scalar" };
}

const stringCustomTypes = new Set<CustomFieldType>([
  "text",
  "large_text",
  "autocomplete",
  "phone",
  "date",
  "time",
]);

export function compatibleCustomOutput(
  type: CustomFieldType,
  output: ConfigurationOutput,
): boolean {
  if (stringCustomTypes.has(type)) return output.type === "string";
  return (type === "numeric" || type === "monetary") && output.type === "number";
}

export function customFieldReferenceOptions(
  definition: WorkflowDefinition,
  nodeId: string,
  def: CustomFieldDef,
) {
  const available = ancestors(definition, nodeId);
  return definition.nodes
    .filter((node) => available.has(node.id))
    .flatMap((node) =>
      Object.entries(actionRegistry[node.type].outputs).flatMap(([field, type]) => {
        const binding = { kind: "reference" as const, nodeId: node.id, path: field.split(".") };
        const output = configurationOutput(definition, nodeId, binding);
        if (output === null || !compatibleCustomOutput(def.type, output)) return [];
        return [{ key: node.id + "." + field, node, field, type, binding }];
      }),
    );
}

export function compatibleBuiltinOutput(
  expected: "string" | "deal" | "number" | "scalar",
  output: ConfigurationOutput,
): boolean {
  if (expected === "deal") return output.semantic === "deal";
  // Exact decimal outputs are stored strings. Existing condition comparisons use
  // those strings unchanged; they never become numeric custom values or waits.
  if (expected === "scalar") return true;
  return output.type === expected;
}

export function bindingOutputType(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  binding: Binding,
): ValueType | "null" | undefined {
  if (binding.kind === "reference") return configurationOutput(definition, node.id, binding)?.type;
  if (binding.value === null) return "null";
  if (typeof binding.value === "string") return "string";
  return typeof binding.value === "number" ? "number" : "boolean";
}
