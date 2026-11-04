"use client";

import { type ReactNode, useId } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations, useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { type MappingKind, mappingOptions } from "../mappingOptions";
import { displayNodeName } from "../nodeNames";
import { orderedWorkflowNodes } from "../nodeOrder";
import { type Binding, bindingSchema, type WorkflowDefinition } from "../schemas";

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
  const parsed = bindingSchema.safeParse(value);
  const binding = parsed.success ? parsed.data : undefined;
  const choices = mappingOptions(definition, nodeId, kind);
  const orderedNodes = orderedWorkflowNodes(definition);
  const selected =
    binding?.kind === "reference"
      ? binding.nodeId + "." + binding.path.join(".")
      : binding?.kind === "value" && binding.value === null && allowNull
        ? "__null__"
        : binding === undefined && onOmit !== undefined
          ? "__omit__"
          : literalControl !== undefined
            ? "__record__"
            : "__literal__";
  const missing =
    binding?.kind === "reference" && !choices.some((choice) => choice.key === selected);
  const options = [
    ...(onOmit === undefined ? [] : [{ value: "__omit__", label: t("customValueOmitted") }]),
    ...(allowNull
      ? [{ value: "__null__", label: nullLabel ?? t("configurationNoLinkedDeal") }]
      : []),
    ...(literalControl === undefined
      ? []
      : [
          { value: "__record__", label: literalControlLabel ?? t("configurationLiteralReference") },
        ]),
    ...(allowLiteral ? [{ value: "__literal__", label: t("literalValue") }] : []),
    ...choices.map((choice) => ({
      value: choice.key,
      label:
        (fields[choice.field] ?? choice.field) +
        " · " +
        displayNodeName(choice.node, locale) +
        " " +
        fmt.number(orderedNodes.findIndex((node) => node.id === choice.node.id) + 1),
      group: t("connectedValues"),
    })),
    ...(missing ? [{ value: selected, label: t("unavailableValue") }] : []),
  ];
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
      {selected === "__record__" &&
        (typeof literalControl === "function" ? literalControl(`${id}-error`) : literalControl)}
      {allowLiteral && selected === "__literal__" && (
        <div className="space-y-2 pt-2">
          <label htmlFor={id} className="text-sm font-medium">
            {label}
          </label>
          <Input
            dir="auto"
            id={id}
            value={binding?.kind === "value" ? String(binding.value ?? "") : ""}
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
      {!allowLiteral && choices.length === 0 && (
        <p className="text-xs leading-5 text-muted-foreground">{t("noVariables")}</p>
      )}
    </fieldset>
  );
}
