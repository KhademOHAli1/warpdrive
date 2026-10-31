"use client";

import { useId } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations, useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { type MappingKind, mappingOptions } from "../mappingOptions";
import { displayNodeName } from "../nodeNames";
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
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const fmt = useFormatters();
  const fields: Record<string, string> = useMessages().workflows.fields;
  const id = useId();
  const parsed = bindingSchema.safeParse(value);
  const binding = parsed.success ? parsed.data : undefined;
  const choices = mappingOptions(definition, nodeId, kind);
  const selected =
    binding?.kind === "reference" ? binding.nodeId + "." + binding.path.join(".") : "__literal__";
  const missing =
    binding?.kind === "reference" && !choices.some((choice) => choice.key === selected);
  const options = [
    ...(allowLiteral ? [{ value: "__literal__", label: t("literalValue") }] : []),
    ...choices.map((choice) => ({
      value: choice.key,
      label:
        (fields[choice.field] ?? choice.field) +
        " · " +
        displayNodeName(choice.node, locale) +
        " " +
        fmt.number(definition.nodes.findIndex((node) => node.id === choice.node.id) + 1),
      group: t("connectedValues"),
    })),
    ...(missing ? [{ value: selected, label: t("unavailableValue") }] : []),
  ];
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{sourceLabel}</p>
      <Select
        ariaLabel={sourceLabel}
        value={selected}
        options={options}
        disabled={!editable}
        placeholder={t("chooseValue")}
        onChange={(key) => {
          if (key === "__literal__") onChange({ kind: "value", value: "" });
          else {
            const choice = choices.find((item) => item.key === key);
            if (choice !== undefined) onChange(choice.binding);
          }
        }}
      />
      {allowLiteral && binding?.kind !== "reference" && (
        <div className="space-y-2 pt-2">
          <label htmlFor={id} className="text-sm font-medium">
            {label}
          </label>
          <Input
            dir="auto"
            id={id}
            value={binding?.kind === "value" ? String(binding.value ?? "") : ""}
            disabled={!editable}
            maxLength={kind === "text" ? 255 : 120}
            onChange={(event) => onChange({ kind: "value", value: event.target.value })}
          />
        </div>
      )}
      {missing && (
        <p role="alert" className="text-xs leading-5 text-destructive">
          {t("mappingInvalid")}
        </p>
      )}
      {!allowLiteral && choices.length === 0 && (
        <p className="text-xs leading-5 text-muted-foreground">{t("noVariables")}</p>
      )}
    </div>
  );
}
