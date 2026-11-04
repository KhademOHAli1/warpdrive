"use client";

import { type ReactNode, useId } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations, useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { MappingKind } from "../mappingOptions";
import type { Binding, WorkflowDefinition } from "../schemas";
import { bindingFieldModel, bindingFieldOptions } from "./bindingFieldModel";

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
}: {
  definition: WorkflowDefinition;
  nodeId: string;
  value: unknown;
  onChange: (binding: Binding) => void;
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
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const fmt = useFormatters();
  const fields: Record<string, string> = useMessages().workflows.fields;
  const id = useId();
  const model = bindingFieldModel(definition, nodeId, value, kind, {
    allowLiteral,
    allowNull,
    hasOmit: onOmit !== undefined,
    hasRecord: literalControl !== undefined,
  });
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
          if (key === "__omit__") onOmit?.();
          else if (key === "__null__") onChange({ kind: "value", value: null });
          else if (key === "__record__") {
            if (onSelectLiteral === undefined) onChange({ kind: "value", value: "" });
            else onSelectLiteral();
          } else if (key === "__literal__") onChange({ kind: "value", value: "" });
          else {
            const choice = choices.find((item) => item.key === key);
            if (choice !== undefined) onChange(choice.binding);
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
          <Input
            dir="auto"
            id={id}
            value={model.literalValue}
            disabled={!editable}
            maxLength={maxLength ?? (kind === "text" ? 255 : 120)}
            aria-invalid={error !== undefined}
            aria-describedby={error === undefined ? undefined : `${id}-error`}
            onChange={(event) => onChange({ kind: "value", value: event.target.value })}
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
    </fieldset>
  );
}
