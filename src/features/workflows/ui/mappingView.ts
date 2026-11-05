import type { Locale } from "@/features/i18n/registry";
import type { ConfigurationMetadata } from "../configurationTypes";
import {
  describeMappingOutputs,
  describeMappingTarget,
  inspectMapping,
  legacyMappingTarget,
} from "../mappingCatalog";
import type { MappingKind } from "../mappingOptions";
import { buildMappingPreview } from "../mappingPreview";
import type {
  MappingInspection,
  MappingOutput,
  MappingPreview,
  MappingTarget,
} from "../mappingTypes";
import { displayNodeName } from "../nodeNames";
import { orderedWorkflowNodes } from "../nodeOrder";
import type { ReferenceBinding, WorkflowDefinition } from "../schemas";

export interface MappingChoice {
  binding: ReferenceBinding;
  output: MappingOutput;
  compatibility: "compatible" | "runtime-value-check";
}
export interface MappingPickerModel {
  state: "ready" | "incomplete" | "denied";
  editable: boolean;
  choices: readonly MappingChoice[];
  selected: MappingInspection;
  preview: MappingPreview;
  definition: WorkflowDefinition;
  target: MappingTarget | undefined;
}

export function buildMappingPickerModel(
  definition: WorkflowDefinition,
  nodeId: string,
  target: MappingTarget | undefined,
  raw: unknown,
  metadata: ConfigurationMetadata | undefined,
  editable: boolean,
): MappingPickerModel {
  const catalog = describeMappingOutputs(definition, nodeId, metadata);
  const state =
    metadata?.status === "denied" ? "denied" : target === undefined ? "incomplete" : catalog.state;
  const inspection = inspectMapping(definition, nodeId, target, raw, metadata);
  const selected = state === "denied" ? { ...inspection, source: undefined } : inspection;
  const choices: MappingChoice[] = [];
  if (state !== "denied" && target?.mode === "binding") {
    for (const output of catalog.outputs) {
      const binding: ReferenceBinding = {
        kind: "reference",
        nodeId: output.nodeId,
        path: [...output.path],
      };
      const checked = inspectMapping(definition, nodeId, target, binding, metadata);
      if (checked.availability === "available" && checked.compatibility !== "incompatible")
        choices.push({ binding, output, compatibility: checked.compatibility });
    }
  }
  const order = orderedWorkflowNodes(definition).map((node) => node.id);
  choices.sort(
    (left, right) => order.indexOf(left.output.nodeId) - order.indexOf(right.output.nodeId),
  );
  return {
    state,
    editable,
    choices,
    selected,
    preview: buildMappingPreview(raw, selected),
    definition,
    target,
  };
}

export function mappingSourceView(
  model: MappingPickerModel,
  source: MappingOutput | undefined,
  locale: Locale,
  fields: Readonly<Record<string, string>>,
  formatNumber: (value: number) => string,
) {
  if (model.state === "denied" || source === undefined) return undefined;
  const node = model.definition.nodes.find((item) => item.id === source.nodeId);
  if (node === undefined) return undefined;
  const order = orderedWorkflowNodes(model.definition);
  return {
    name: displayNodeName(node, locale),
    field: source.label ?? fields[source.field] ?? "",
    number: formatNumber(order.findIndex((item) => item.id === node.id) + 1),
    kind: source.contract.kind,
  };
}

export function mappingReferenceKey(binding: ReferenceBinding): string {
  return JSON.stringify([binding.nodeId, binding.path]);
}

export function bindingTarget(
  definition: WorkflowDefinition,
  nodeId: string,
  kind: MappingKind,
  target: MappingTarget | undefined,
  path: readonly string[] | undefined,
  metadata: ConfigurationMetadata | undefined,
  nullable: boolean,
  required: boolean,
) {
  if (target !== undefined) return target;
  if (path === undefined) return legacyMappingTarget(nodeId, kind, { nullable, required });
  const described = describeMappingTarget(definition, nodeId, path, metadata);
  return described.state === "ready" ? described.target : undefined;
}

export function bindingChoices(model: MappingPickerModel) {
  return model.choices.flatMap((choice) => {
    const node = model.definition.nodes.find((node) => node.id === choice.output.nodeId);
    return node === undefined
      ? []
      : [
          {
            key: choice.binding.nodeId + "." + choice.binding.path.join("."),
            node,
            field: choice.output.field,
            binding: choice.binding,
          },
        ];
  });
}
