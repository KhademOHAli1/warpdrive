import type { CustomFieldType } from "@/constants/customFieldTypes";
import type { CustomFieldDef } from "@/types/customFields";
import { describeMappingOutputs, legacyMappingTarget } from "./mappingCatalog";
import { customMappingContract, mappingCompatibility } from "./mappingCompatibility";
import { coarseMappingType } from "./mappingOutputs";
import type { MappingValueContract } from "./mappingTypes";
import {
  type Binding,
  bindingSchema,
  type ValueType,
  type WorkflowDefinition,
  type WorkflowNode,
} from "./schemas";

export interface ConfigurationOutput {
  type: ValueType;
  semantic: "deal" | "scalar";
  contract: MappingValueContract;
}

export function configurationOutput(
  definition: WorkflowDefinition,
  nodeId: string,
  binding: Extract<Binding, { kind: "reference" }>,
): ConfigurationOutput | null {
  const source = describeMappingOutputs(definition, nodeId).outputs.find(
    (output) =>
      output.nodeId === binding.nodeId && output.path.join(".") === binding.path.join("."),
  );
  if (source === undefined) return null;
  return {
    type: coarseMappingType(source.contract),
    semantic: source.contract.entity === "deal" ? "deal" : "scalar",
    contract: source.contract,
  };
}

export function compatibleCustomOutput(
  type: CustomFieldType,
  output: ConfigurationOutput,
): boolean {
  const target = {
    ...legacyMappingTarget("target", "scalar"),
    contract: customMappingContract(type),
  };
  return mappingCompatibility(output.contract, target) !== "incompatible";
}

export function customFieldReferenceOptions(
  definition: WorkflowDefinition,
  nodeId: string,
  def: CustomFieldDef,
) {
  const target = {
    ...legacyMappingTarget(nodeId, "scalar"),
    contract: customMappingContract(def.type, def.id),
  };
  return describeMappingOutputs(definition, nodeId).outputs.flatMap((output) => {
    if (mappingCompatibility(output.contract, target) === "incompatible") return [];
    const node = definition.nodes.find((entry) => entry.id === output.nodeId);
    if (node === undefined) return [];
    return [
      {
        key: output.nodeId + "." + output.path.join("."),
        node,
        field: output.field,
        type: coarseMappingType(output.contract),
        binding: { kind: "reference" as const, nodeId: output.nodeId, path: [...output.path] },
      },
    ];
  });
}

export function compatibleBuiltinOutput(
  expected: "string" | "deal" | "number" | "scalar",
  output: ConfigurationOutput,
): boolean {
  const target = legacyMappingTarget(
    "target",
    expected === "string" ? "text" : expected === "number" ? "scalar" : expected,
  );
  if (expected === "number") target.contract = { kind: "number", nullable: false };
  return mappingCompatibility(output.contract, target) !== "incompatible";
}

export function bindingOutputType(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  binding: Binding,
): ValueType | "null" | undefined {
  if (binding.kind === "reference") return configurationOutput(definition, node.id, binding)?.type;
  if (binding.literalType !== undefined) return binding.literalType;
  if (binding.value === null) return "null";
  if (typeof binding.value === "string") return "string";
  return typeof binding.value === "number" ? "number" : "boolean";
}

export function temporalConditionMismatch(
  definition: WorkflowDefinition,
  node: WorkflowNode,
): boolean {
  if ((node.type !== "condition" && node.type !== "filter") || node.config.operator === "exists")
    return false;
  const left = bindingSchema.safeParse(node.config.left);
  const right = bindingSchema.safeParse(node.config.right);
  if (!left.success || !right.success) return false;
  const leftType = bindingOutputType(definition, node, left.data);
  const rightType = bindingOutputType(definition, node, right.data);
  if (leftType === "null" || rightType === "null") return false;
  const temporal =
    leftType === "date" ||
    leftType === "instant" ||
    rightType === "date" ||
    rightType === "instant";
  return temporal && leftType !== rightType;
}

export function conditionContainsMismatch(
  definition: WorkflowDefinition,
  node: WorkflowNode,
): boolean {
  if ((node.type !== "condition" && node.type !== "filter") || node.config.operator !== "contains")
    return false;
  return ["left", "right"].some((field) => {
    const parsed = bindingSchema.safeParse(node.config[field]);
    if (!parsed.success) return false;
    const type = bindingOutputType(definition, node, parsed.data);
    return type !== undefined && type !== "string" && type !== "decimal";
  });
}
