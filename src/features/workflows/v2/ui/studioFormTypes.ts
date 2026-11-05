import type {
  BlockFieldDescriptor,
  BlockJson,
  WorkflowV2Definition,
  WorkflowV2Node,
  WorkflowV2Studio,
} from "@/features/blocks/contracts";
export interface StudioFormProps {
  node: WorkflowV2Node;
  definition: WorkflowV2Definition;
  studio: WorkflowV2Studio;
  disabled: boolean;
  onChange: (config: Record<string, BlockJson>) => void;
}
export function fieldCatalog(studio: WorkflowV2Studio): Record<string, BlockFieldDescriptor[]> {
  return Object.fromEntries(studio.objects.map((object) => [object.name, object.fields]));
}
