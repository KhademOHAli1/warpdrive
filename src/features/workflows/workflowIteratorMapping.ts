import { isMappingFieldKey, mappingOutputContracts } from "./mappingOutputs";
import type { MappingOutput } from "./mappingTypes";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";
import { workflowIteratorConfig } from "./workflowIteratorRuntimeContract";
import {
  recordSearchConfig,
  recordSearchFieldContract,
  recordSearchFields,
} from "./workflowRecordQueryContract";

export function iteratorMappingOutputs(
  definition: WorkflowDefinition,
  node: WorkflowNode,
): MappingOutput[] {
  const parsed = workflowIteratorConfig.safeParse(node.config);
  if (!parsed.success) return [];
  const outputs = Object.entries(mappingOutputContracts("iterator")).flatMap(([field, contract]) =>
    isMappingFieldKey(field) ? [{ nodeId: node.id, path: [field], field, contract }] : [],
  );
  const input = parsed.data.items;
  if (input.kind === "literal")
    return [
      ...outputs,
      {
        nodeId: node.id,
        path: ["currentItem"],
        field: "currentItem",
        contract: { kind: input.itemKind, nullable: input.items.includes(null) },
      },
    ];
  const source = definition.nodes.find(
    (entry) => entry.id === input.nodeId && entry.type === "record.search",
  );
  const search = recordSearchConfig.safeParse(source?.config);
  if (!search.success) return outputs;
  const entity = search.data.entity;
  return [
    ...outputs,
    ...recordSearchFields[entity].map((field) => ({
      nodeId: node.id,
      path: ["currentItem", field],
      field,
      contract: recordSearchFieldContract(entity, field),
    })),
  ];
}

export function iteratorOutputVisible(
  definition: WorkflowDefinition,
  output: MappingOutput,
  directSuccessorId: string,
): boolean {
  const step = definition.edges.find(
    (edge) => edge.from === output.nodeId && edge.to === directSuccessorId,
  );
  const inside = output.path[0] === "currentItem" || output.path[0] === "currentItemIndex";
  return step?.port === (inside ? "loop" : "done");
}
