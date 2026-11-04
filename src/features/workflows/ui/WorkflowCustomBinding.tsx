"use client";
import { useId } from "react";
import { z } from "zod";
import { Select } from "@/components/ui/Select";
import { useAppTranslations, useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import type { CustomFieldDef } from "@/types/customFields";
import { customFieldBindingSchema } from "../configurationBindings";
import { customFieldReferenceOptions } from "../configurationReference";
import { displayNodeName } from "../nodeNames";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { useWorkflowConfigurationReferences } from "./useWorkflowConfigurationReferences";
import {
  type WorkflowCustomReference,
  WorkflowCustomValueControl,
} from "./WorkflowCustomValueControl";

interface Props {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  def: CustomFieldDef;
  workflowId?: string;
  fingerprint?: string;
  editable: boolean;
  error?: string;
  onChange: (node: WorkflowNode) => void;
}
function isMap(value: WorkflowNode["config"][string] | undefined): value is WorkflowNode["config"] {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function CustomBinding({ reference, ...props }: Props & { reference?: WorkflowCustomReference }) {
  const { definition, node, def, editable, error, onChange } = props;
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const fields: Record<string, string> = useMessages().workflows.fields;
  const errorId = useId();
  const settings = isMap(node.config.customFields) ? node.config.customFields : {};
  const raw = Object.hasOwn(settings, def.id) ? settings[def.id] : undefined;
  const parsed = customFieldBindingSchema.safeParse(raw);
  const binding = parsed.success ? parsed.data : undefined;
  const choices = customFieldReferenceOptions(definition, node.id, def);
  const selected =
    binding?.kind === "reference" ? binding.nodeId + "." + binding.path.join(".") : "__literal__";
  const missing =
    binding?.kind === "reference" && !choices.some((choice) => choice.key === selected);
  function literal(value: unknown) {
    if (!editable) return;
    const current = isMap(node.config.customFields) ? { ...node.config.customFields } : {};
    if (value === undefined) delete current[def.id];
    else {
      const json = z.json().safeParse(value);
      if (!json.success) return;
      current[def.id] = { kind: "value", value: json.data };
    }
    onChange({ ...node, config: { ...node.config, customFields: current } });
  }
  return (
    <div className="space-y-2">
      {(choices.length > 0 || binding?.kind === "reference") && (
        <Select
          ariaLabel={def.name + " · " + t("configurationUseMapping")}
          value={selected}
          disabled={!editable}
          options={[
            { value: "__literal__", label: t("literalValue") },
            ...choices.map((choice) => ({
              value: choice.key,
              label:
                (fields[choice.field] ?? choice.field) +
                " · " +
                displayNodeName(choice.node, locale),
            })),
            ...(missing ? [{ value: selected, label: t("unavailableValue") }] : []),
          ]}
          onChange={(key) => {
            if (!editable) return;
            if (key === "__literal__") literal("");
            else {
              const choice = choices.find((item) => item.key === key);
              if (choice !== undefined)
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    customFields: { ...settings, [def.id]: choice.binding },
                  },
                });
            }
          }}
        />
      )}
      {binding?.kind === "reference" ? (
        <fieldset
          aria-label={def.name}
          aria-invalid={error !== undefined || missing}
          aria-describedby={errorId}
          className="text-xs text-muted-foreground"
        >
          <p id={errorId}>
            {error ??
              (missing ? t("configurationReferenceUnavailable") : t("configurationUseMapping"))}
          </p>
        </fieldset>
      ) : (
        <WorkflowCustomValueControl
          def={def}
          value={
            isMap(raw) && raw.kind === "value" && Object.hasOwn(raw, "value")
              ? raw.value
              : undefined
          }
          onChange={literal}
          editable={editable}
          error={error}
          reference={reference}
        />
      )}
    </div>
  );
}
function ReferencedCustomBinding(props: Props) {
  const t = useAppTranslations("workflows");
  const raw = isMap(props.node.config.customFields)
    ? props.node.config.customFields[props.def.id]
    : undefined;
  const binding = customFieldBindingSchema.safeParse(raw);
  const selectedId =
    binding.success && binding.data.kind === "value" && typeof binding.data.value === "string"
      ? binding.data.value
      : undefined;
  const reference = useWorkflowConfigurationReferences({
    workflowId: props.workflowId,
    type: props.node.type,
    selector: { kind: "custom", fieldId: props.def.id },
    fingerprint: props.fingerprint,
    selectedId,
    enabled: props.workflowId !== undefined,
  });
  return (
    <CustomBinding
      {...props}
      reference={reference}
      error={
        props.error ??
        (reference.unavailable
          ? t("configurationSelectedUnavailable")
          : reference.stale
            ? t("configurationMetadataStale")
            : undefined)
      }
    />
  );
}
export function WorkflowCustomBinding(props: Props) {
  return props.def.type === "user" || props.def.type === "person" || props.def.type === "org" ? (
    <ReferencedCustomBinding {...props} />
  ) : (
    <CustomBinding {...props} />
  );
}
