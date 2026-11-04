import { describeMappingOutputs, legacyMappingTarget } from "./mappingCatalog";
import { mappingCompatibility } from "./mappingCompatibility";
import { coarseMappingType } from "./mappingOutputs";
import type { WorkflowDefinition } from "./schemas";

export type MappingKind = "text" | "deal" | "scalar";
export function mappingOptions(graph: WorkflowDefinition, nodeId: string, kind: MappingKind) {
  const target = legacyMappingTarget(nodeId, kind);
  return describeMappingOutputs(graph, nodeId).outputs.flatMap((output) => {
    if (mappingCompatibility(output.contract, target) === "incompatible") return [];
    const node = graph.nodes.find((entry) => entry.id === output.nodeId);
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
