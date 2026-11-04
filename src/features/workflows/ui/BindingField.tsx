"use client";

import { type ReactNode, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useAppTranslations, useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { applyConditionMappingSelection } from "../conditionMapping";
import type { ConfigurationMetadata } from "../configurationTypes";
import { inspectMapping, sameMappingReference } from "../mappingCatalog";
import type { MappingKind } from "../mappingOptions";
import type { MappingTarget } from "../mappingTypes";
import type { DraftBinding, ReferenceBinding, WorkflowDefinition, WorkflowNode } from "../schemas";
import { bindingFieldModel, bindingFieldOptions } from "./bindingFieldModel";
import { MappingChip } from "./MappingChip";
import { MappingPreview } from "./MappingPreview";
import { bindingChoices, bindingTarget, buildMappingPickerModel } from "./mappingView";
import { TypedLiteralValue } from "./TypedLiteralValue";
import { VariablePicker } from "./VariablePicker";

export interface ConditionBindingSelection {
  predicateId: string;
  onChange: (node: WorkflowNode) => void;
}

export function BindingField({
  definition,
  nodeId,
  value,
  onChange,
  kind,
  label,
  sourceLabel,
  editable,
  allowLiteral = true,
  allowNull = false,
  onOmit,
  literalControl,
  literalControlLabel,
  onSelectLiteral,
  nullLabel,
  error,
  maxLength,
  target,
  metadata,
  path,
  conditionSelection,
}: {
  definition: WorkflowDefinition;
  nodeId: string;
  value: unknown;
  onChange: (binding: DraftBinding) => void;
  kind: MappingKind;
  label: string;
  sourceLabel: string;
  editable: boolean;
  allowLiteral?: boolean;
  allowNull?: boolean;
  onOmit?: () => void;
  literalControl?: ReactNode | ((errorId: string) => ReactNode);
  literalControlLabel?: string;
  onSelectLiteral?: () => void;
  nullLabel?: string;
  error?: string;
  maxLength?: number;
  target?: MappingTarget;
  metadata?: ConfigurationMetadata;
  path?: readonly string[];
  conditionSelection?: ConditionBindingSelection;
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const fmt = useFormatters();
  const fields: Record<string, string> = useMessages().workflows.fields;
  const id = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openedScope, setOpenedScope] = useState<{
    path: readonly string[];
    predicateId: string;
  }>();
  const opener = useRef<HTMLButtonElement>(null);
  const preview = useRef<HTMLElement>(null);
  const currentTarget = bindingTarget(
    definition,
    nodeId,
    kind,
    target,
    path,
    metadata,
    allowNull,
    onOmit === undefined,
  );
  const picker = buildMappingPickerModel(
    definition,
    nodeId,
    currentTarget,
    value,
    metadata,
    editable,
  );
  const typedChoices = bindingChoices(picker);
  const model = bindingFieldModel(
    definition,
    nodeId,
    value,
    kind,
    {
      allowLiteral,
      allowNull,
      hasOmit: onOmit !== undefined,
      hasRecord: literalControl !== undefined,
    },
    typedChoices,
  );
  const { choices, selected, missing } = model;
  const options = bindingFieldOptions(
    model,
    definition,
    locale,
    fields,
    (number) => fmt.number(number),
    {
      omit: t("customValueOmitted"),
      null: nullLabel ?? t("configurationNoLinkedDeal"),
      record: literalControlLabel ?? t("configurationLiteralReference"),
      literal: t("literalValue"),
      connected: t("connectedValues"),
      missing: t("unavailableValue"),
    },
  );
  function choose(reference: ReferenceBinding) {
    if (!editable || picker.state === "denied") return;
    const checked = inspectMapping(definition, nodeId, currentTarget, reference, metadata);
    if (checked.availability !== "available" || checked.compatibility === "incompatible") return;
    if (conditionSelection !== undefined) {
      const scope = pickerOpen
        ? openedScope
        : { path: currentTarget?.path ?? [], predicateId: conditionSelection.predicateId };
      if (scope === undefined) return;
      const result = applyConditionMappingSelection(
        definition,
        nodeId,
        { path: scope.path, expectedPredicateId: scope.predicateId, binding: reference },
        metadata,
        editable,
      );
      if (!result.ok) return;
      const changed = result.definition.nodes.find((node) => node.id === nodeId);
      if (result.changed && changed !== undefined) conditionSelection.onChange(changed);
    } else if (!sameMappingReference(value, reference)) onChange(reference);
    setPickerOpen(false);
  }
  function openPicker() {
    setOpenedScope(
      conditionSelection === undefined
        ? undefined
        : { path: [...(currentTarget?.path ?? [])], predicateId: conditionSelection.predicateId },
    );
    setPickerOpen(true);
  }
  function restoreFocus(event: Event) {
    event.preventDefault();
    if (
      opener.current?.isConnected === true &&
      !opener.current.matches(":disabled,[aria-disabled=true]")
    )
      opener.current.focus();
    else preview.current?.focus();
  }
  return (
    <fieldset
      className="min-w-0 space-y-2"
      aria-label={sourceLabel}
      aria-invalid={error !== undefined}
      aria-describedby={error === undefined ? undefined : `${id}-error`}
    >
      <p className="text-sm font-medium">{sourceLabel}</p>
      <Select
        ariaLabel={sourceLabel}
        value={selected}
        options={options}
        disabled={!editable}
        placeholder={t("chooseValue")}
        onChange={(key) => {
          if (!editable) return;
          if (key === "__omit__") onOmit?.();
          else if (key === "__null__") onChange({ kind: "value", value: null });
          else if (key === "__record__") {
            if (onSelectLiteral === undefined) onChange({ kind: "value", value: "" });
            else onSelectLiteral();
          } else if (key === "__literal__") onChange({ kind: "value", value: "" });
          else {
            const choice = choices.find((item) => item.key === key);
            if (choice !== undefined) choose(choice.binding);
          }
        }}
      />
      {model.showRecord &&
        (typeof literalControl === "function" ? literalControl(`${id}-error`) : literalControl)}
      {model.showLiteral && (
        <div className="space-y-2 pt-2">
          <label htmlFor={id} className="text-sm font-medium">
            {label}
          </label>
          <TypedLiteralValue
            id={id}
            binding={model.binding?.kind === "value" ? model.binding : { kind: "value", value: "" }}
            target={currentTarget}
            label={label}
            editable={editable}
            maxLength={maxLength ?? (kind === "text" ? 255 : 120)}
            error={error}
            errorId={`${id}-error`}
            hideError
            onChange={onChange}
          />
        </div>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
      {missing && (
        <p role="alert" className="text-xs leading-5 text-destructive">
          {t("mappingInvalid")}
        </p>
      )}
      {model.noVariables && (
        <p className="text-xs leading-5 text-muted-foreground">{t("noVariables")}</p>
      )}
      <Button
        ref={opener}
        size="sm"
        variant="outline"
        disabled={!editable || picker.state === "denied"}
        onClick={openPicker}
      >
        {t("mappingChooseSource")}
      </Button>
      {model.binding?.kind === "reference" && (
        <MappingChip
          model={picker}
          onInspect={() => preview.current?.focus()}
          onChange={openPicker}
          onRemove={() => {
            if (!editable) return;
            if (onOmit !== undefined) onOmit();
            else if (onSelectLiteral !== undefined) onSelectLiteral();
            else onChange({ kind: "value", value: "" });
          }}
        />
      )}
      <MappingPreview
        model={picker.preview}
        focusRef={preview}
        id={`${id}-preview`}
        denied={picker.state === "denied"}
      />
      <VariablePicker
        open={pickerOpen}
        model={picker}
        onChoose={choose}
        onClose={() => setPickerOpen(false)}
        onCloseAutoFocus={restoreFocus}
      />
    </fieldset>
  );
}
