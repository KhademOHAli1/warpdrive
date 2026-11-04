"use client";
import { useId, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useAppTranslations, useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { CustomFieldDef } from "@/types/customFields";
import { customFieldBindingSchema } from "../configurationBindings";
import type { ConfigurationMetadata } from "../configurationTypes";
import { applyMappingSelection, describeMappingTarget } from "../mappingCatalog";
import type { ReferenceBinding, WorkflowDefinition, WorkflowNode } from "../schemas";
import { MappingChip } from "./MappingChip";
import { MappingPreview } from "./MappingPreview";
import {
  buildMappingPickerModel,
  type MappingPickerModel,
  mappingReferenceKey,
  mappingSourceView,
} from "./mappingView";
import { useWorkflowConfigurationReferences } from "./useWorkflowConfigurationReferences";
import { VariablePicker } from "./VariablePicker";
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
  metadata?: ConfigurationMetadata;
  editable: boolean;
  error?: string;
  onChange: (node: WorkflowNode) => void;
}
function isMap(value: unknown): value is WorkflowNode["config"] {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function customSettings(node: WorkflowNode) {
  return isMap(node.config.customFields) ? node.config.customFields : {};
}
function CustomMode({
  model,
  reference,
  name,
  editable,
  literal,
  choose,
}: {
  model: MappingPickerModel;
  reference: ReferenceBinding | undefined;
  name: string;
  editable: boolean;
  literal: () => void;
  choose: (reference: ReferenceBinding) => void;
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const messages = useMessages().workflows;
  const format = useFormatters();
  const choices = model.choices.flatMap((choice) => {
    const source = mappingSourceView(model, choice.output, locale, messages.fields, format.number);
    return source === undefined
      ? []
      : [
          {
            value: mappingReferenceKey(choice.binding),
            label: `${source.field} · ${source.name} ${source.number}`,
            binding: choice.binding,
          },
        ];
  });
  if (choices.length === 0 && reference === undefined) return null;
  const selected = reference === undefined ? "__literal__" : mappingReferenceKey(reference);
  const missing = reference !== undefined && !choices.some((choice) => choice.value === selected);
  return (
    <Select
      ariaLabel={name + " · " + t("configurationUseMapping")}
      value={selected}
      disabled={!editable || model.state === "denied"}
      options={[
        { value: "__literal__", label: t("literalValue") },
        ...choices,
        ...(missing ? [{ value: selected, label: t("unavailableValue") }] : []),
      ]}
      onChange={(key) => {
        if (!editable) return;
        if (key === "__literal__") literal();
        else {
          const choice = choices.find((choice) => choice.value === key);
          if (choice !== undefined) choose(choice.binding);
        }
      }}
    />
  );
}
function CustomValue({
  props,
  raw,
  reference,
  bindingReference,
  missing,
  errorId,
}: {
  props: Props & { onChangeValue: (value: unknown) => void };
  raw: unknown;
  reference: WorkflowCustomReference | undefined;
  bindingReference: ReferenceBinding | undefined;
  missing: boolean;
  errorId: string;
}) {
  const t = useAppTranslations("workflows");
  const { def, editable, error } = props;
  if (bindingReference !== undefined)
    return (
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
    );
  return (
    <WorkflowCustomValueControl
      def={def}
      value={
        isMap(raw) && raw.kind === "value" && Object.hasOwn(raw, "value") ? raw.value : undefined
      }
      onChange={props.onChangeValue}
      editable={editable}
      error={error}
      reference={reference}
    />
  );
}
function CustomBinding({ reference, ...props }: Props & { reference?: WorkflowCustomReference }) {
  const { definition, node, def, editable, onChange } = props;
  const t = useAppTranslations("workflows");
  const errorId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const preview = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const settings = customSettings(node);
  const raw = Object.hasOwn(settings, def.id) ? settings[def.id] : undefined;
  const parsed = customFieldBindingSchema.safeParse(raw);
  const bindingReference =
    parsed.success && parsed.data.kind === "reference" ? parsed.data : undefined;
  const context: ConfigurationMetadata = props.metadata ?? {
    status: "incomplete",
    defs: [def],
    fingerprint: props.fingerprint,
  };
  const described = describeMappingTarget(definition, node.id, ["customFields", def.id], context);
  const target = described.state === "ready" ? described.target : undefined;
  const model = buildMappingPickerModel(definition, node.id, target, raw, context, editable);
  const missing =
    bindingReference !== undefined &&
    !model.choices.some(
      (choice) => mappingReferenceKey(choice.binding) === mappingReferenceKey(bindingReference),
    );
  function literal(value: unknown) {
    if (!editable) return;
    const current = { ...customSettings(node) };
    if (value === undefined) delete current[def.id];
    else {
      const json = z.json().safeParse(value);
      if (!json.success) return;
      current[def.id] = { kind: "value", value: json.data };
    }
    onChange({ ...node, config: { ...node.config, customFields: current } });
  }
  function choose(reference: ReferenceBinding) {
    if (target === undefined) return;
    const result = applyMappingSelection(definition, node.id, target, reference, context, editable);
    if (!result.ok) return;
    setOpen(false);
    const changed = result.definition.nodes.find((item) => item.id === node.id);
    if (result.changed && changed !== undefined) onChange(changed);
  }
  function restoreFocus(event: Event) {
    event.preventDefault();
    if (opener.current?.isConnected && !opener.current.matches(":disabled,[aria-disabled=true]"))
      opener.current.focus();
    else preview.current?.focus();
  }
  return (
    <div className="space-y-2">
      <CustomMode
        model={model}
        reference={bindingReference}
        name={def.name}
        editable={editable}
        literal={() => literal("")}
        choose={choose}
      />
      <CustomValue
        props={{ ...props, onChangeValue: literal }}
        raw={raw}
        reference={reference}
        bindingReference={bindingReference}
        missing={missing}
        errorId={errorId}
      />
      <Button
        ref={opener}
        variant="outline"
        size="sm"
        disabled={!editable || model.state === "denied"}
        onClick={() => setOpen(true)}
      >
        {t("mappingChooseSource")}
      </Button>
      {bindingReference !== undefined && (
        <MappingChip
          model={model}
          onInspect={() => preview.current?.focus()}
          onChange={() => setOpen(true)}
          onRemove={() => literal(undefined)}
        />
      )}
      <MappingPreview model={model.preview} focusRef={preview} denied={model.state === "denied"} />
      <VariablePicker
        open={open}
        model={model}
        onChoose={choose}
        onClose={() => setOpen(false)}
        onCloseAutoFocus={restoreFocus}
      />
    </div>
  );
}
function ReferencedCustomBinding(props: Props) {
  const t = useAppTranslations("workflows");
  const raw = customSettings(props.node)[props.def.id];
  const binding = customFieldBindingSchema.safeParse(raw);
  const selectedId =
    binding.success && binding.data.kind === "value" && typeof binding.data.value === "string"
      ? binding.data.value
      : undefined;
  const literal = !binding.success || binding.data.kind !== "reference";
  const reference = useWorkflowConfigurationReferences({
    workflowId: props.workflowId,
    type: props.node.type,
    selector: { kind: "custom", fieldId: props.def.id },
    fingerprint: props.fingerprint ?? props.metadata?.fingerprint,
    selectedId,
    enabled: props.workflowId !== undefined && literal,
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
