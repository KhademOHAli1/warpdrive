import type { SelectOption } from "@/components/ui/Select";
import type { Locale } from "@/features/i18n/registry";
import { type MappingKind, mappingOptions } from "../mappingOptions";
import { displayNodeName } from "../nodeNames";
import { orderedWorkflowNodes } from "../nodeOrder";
import {
  type DraftBinding,
  draftBindingSchema,
  type ReferenceBinding,
  type WorkflowDefinition,
  type WorkflowNode,
} from "../schemas";

interface Modes {
  allowLiteral: boolean;
  allowNull: boolean;
  hasOmit: boolean;
  hasRecord: boolean;
}

export interface BindingFieldChoice {
  key: string;
  node: WorkflowNode;
  field: string;
  binding: ReferenceBinding;
}

function selectedBindingKey(binding: DraftBinding | undefined, modes: Modes): string {
  if (binding?.kind === "reference") return binding.nodeId + "." + binding.path.join(".");
  if (binding?.kind === "value" && binding.value === null && modes.allowNull) return "__null__";
  if (binding === undefined && modes.hasOmit) return "__omit__";
  return modes.hasRecord ? "__record__" : "__literal__";
}

export function bindingFieldModel(
  definition: WorkflowDefinition,
  nodeId: string,
  value: unknown,
  kind: MappingKind,
  modes: Modes,
  providedChoices?: readonly BindingFieldChoice[],
) {
  const parsed = draftBindingSchema.safeParse(value);
  const binding = parsed.success ? parsed.data : undefined;
  const choices =
    providedChoices === undefined ? mappingOptions(definition, nodeId, kind) : [...providedChoices];
  const selected = selectedBindingKey(binding, modes);
  const missing =
    binding?.kind === "reference" && !choices.some((choice) => choice.key === selected);
  return {
    binding,
    choices,
    selected,
    missing,
    literalValue: binding?.kind === "value" ? String(binding.value ?? "") : "",
    showRecord: selected === "__record__",
    showLiteral: modes.allowLiteral && selected === "__literal__",
    noVariables: !modes.allowLiteral && choices.length === 0,
    modes,
  };
}

interface OptionLabels {
  omit: string;
  null: string;
  record: string;
  literal: string;
  connected: string;
  missing: string;
}

export function bindingFieldOptions(
  model: ReturnType<typeof bindingFieldModel>,
  definition: WorkflowDefinition,
  locale: Locale,
  fields: Readonly<Record<string, string>>,
  formatNumber: (value: number) => string,
  labels: OptionLabels,
): SelectOption[] {
  const options: SelectOption[] = [];
  if (model.modes.hasOmit) options.push({ value: "__omit__", label: labels.omit });
  if (model.modes.allowNull) options.push({ value: "__null__", label: labels.null });
  if (model.modes.hasRecord) options.push({ value: "__record__", label: labels.record });
  if (model.modes.allowLiteral) options.push({ value: "__literal__", label: labels.literal });
  const ordered = orderedWorkflowNodes(definition);
  for (const choice of model.choices) {
    options.push({
      value: choice.key,
      label:
        (fields[choice.field] ?? choice.field) +
        " · " +
        displayNodeName(choice.node, locale) +
        " " +
        formatNumber(ordered.findIndex((node) => node.id === choice.node.id) + 1),
      group: labels.connected,
    });
  }
  if (model.missing) options.push({ value: model.selected, label: labels.missing });
  return options;
}
