"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import type {
  BlockFieldDescriptor,
  BlockJson,
  BlockReference,
  WorkflowV2Definition,
} from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { BlockBindingField } from "@/features/blocks/ui/BlockField";
import { BlockVariablePicker } from "@/features/blocks/ui/BlockVariablePicker";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import { StudioTemporalValue } from "./StudioTemporalValue";
import {
  asArray,
  asObject,
  rawValue,
  referenceValue,
  studioVariables,
  textValue,
} from "./studioModel";

export interface StudioValueProps {
  label: string;
  value: BlockJson | undefined;
  onChange: (value: BlockJson) => void;
  definition: WorkflowV2Definition;
  nodeId: string;
  fields: Readonly<Record<string, readonly BlockFieldDescriptor[]>>;
  disabled: boolean;
  type?: string;
  multiline?: boolean;
  options?: { value: string; label: string }[];
  help?: string;
}
function parseLiteral(raw: string, type: string, locale: Locale): BlockJson {
  if (type === "array")
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "");
  if (type !== "number" && type !== "decimal") return raw;
  const canonical = normalizeNumberInput(raw, locale);
  if (canonical === null || raw.trim() === "") return raw;
  if (type === "decimal") return canonical;
  const value = Number(canonical);
  return Number.isFinite(value) ? value : raw;
}
function literalText(value: BlockJson | undefined): string {
  const object = asObject(value);
  if (object.kind === "template") return textValue(object.template);
  const raw = rawValue(value);
  return Array.isArray(raw) ? raw.map((item) => textValue(item)).join(", ") : textValue(raw);
}
function literalKind(value: BlockJson | undefined) {
  const raw = rawValue(value);
  if (Array.isArray(raw)) return "array";
  if (typeof raw === "number" || typeof raw === "boolean") return typeof raw;
  return "string";
}
function MultiChoice({
  options,
  value,
  onChange,
  disabled,
}: {
  options: NonNullable<StudioValueProps["options"]>;
  value: BlockJson | undefined;
  onChange: StudioValueProps["onChange"];
  disabled: boolean;
}) {
  const selected = asArray(rawValue(value));
  return (
    <div className="space-y-1">
      {options.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant={selected.includes(option.value) ? "outline" : "ghost"}
          disabled={disabled}
          aria-pressed={selected.includes(option.value)}
          onClick={() =>
            onChange({
              kind: "literal",
              value: selected.includes(option.value)
                ? selected.filter((value) => value !== option.value)
                : [...selected, option.value],
            })
          }
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
function StudioLiteral({
  label,
  value,
  onChange,
  disabled,
  type,
  multiline,
  options,
}: Pick<StudioValueProps, "label" | "value" | "onChange" | "disabled" | "multiline" | "options"> & {
  type: string;
}) {
  const L = useSharedBlocksMessages();
  const { locale } = useLocalePreferences();
  const [authored, setAuthored] = useState<{ stamp: string; raw: string; locale: Locale } | null>(
    null,
  );
  const same = authored !== null && authored.stamp === JSON.stringify(rawValue(value));
  const display = same ? authored.raw : literalText(value);
  function update(raw: string) {
    const object = asObject(value);
    if (object.kind === "template") {
      onChange({ ...object, template: raw });
      return;
    }
    const authoredLocale = same ? authored.locale : locale;
    const literal = parseLiteral(raw, type, authoredLocale);
    setAuthored({ stamp: JSON.stringify(literal), raw, locale: authoredLocale });
    onChange({ kind: "literal", value: literal });
  }
  if (options !== undefined)
    return type === "array" ? (
      <MultiChoice options={options} value={value} onChange={onChange} disabled={disabled} />
    ) : (
      <Select
        ariaLabel={label}
        value={textValue(value)}
        disabled={disabled}
        options={options}
        onChange={update}
      />
    );
  if (type === "boolean")
    return (
      <Select
        ariaLabel={label}
        value={rawValue(value) === true ? "true" : "false"}
        disabled={disabled}
        options={[
          { value: "true", label: L.true },
          { value: "false", label: L.false },
        ]}
        onChange={(raw) => onChange({ kind: "literal", value: raw === "true" })}
      />
    );
  if (type === "instant" || type === "datetime")
    return (
      <StudioTemporalValue
        label={label}
        value={textValue(value)}
        disabled={disabled}
        onChange={update}
      />
    );
  if (multiline === true)
    return (
      <Textarea
        aria-label={label}
        disabled={disabled}
        value={display}
        onChange={(event) => update(event.target.value)}
        maxLength={100_000}
        className="min-h-24 text-xs"
      />
    );
  return (
    <Input
      aria-label={label}
      disabled={disabled}
      type={type === "date" ? "date" : "text"}
      value={display}
      inputMode={type === "number" || type === "decimal" ? "decimal" : undefined}
      onChange={(event) => update(event.target.value)}
      className="h-9 text-xs"
    />
  );
}
function bindingFor(
  value: BlockJson | undefined,
  type: string,
  reference: BlockReference,
): BlockJson {
  const binding = { kind: reference.kind, nodeId: reference.nodeId, path: reference.path };
  const text = literalText(value);
  if (type !== "string" || text.trim() === "" || referenceValue(value) !== null) return binding;
  const variables = asObject(asObject(value).variables);
  const key = `value_${Object.keys(variables).length + 1}`;
  return {
    kind: "template",
    template: `${text} {{${key}}}`,
    variables: { ...variables, [key]: binding },
  };
}
export function StudioValue(props: StudioValueProps) {
  const L = useSharedBlocksMessages();
  const [open, setOpen] = useState(false);
  const {
    label,
    value,
    onChange,
    definition,
    nodeId,
    fields,
    disabled,
    type = "string",
    help,
  } = props;
  const { choices, references } = studioVariables(definition, nodeId, fields, {
    wholeRecord: L.types.record ?? "",
    wholeList: L.types.array ?? "",
    output: L.output,
  });
  const compatible = choices.filter(
    (choice) =>
      type === "any" ||
      choice.type === type ||
      (type === "string" &&
        literalText(value).trim() !== "" &&
        ["number", "boolean", "decimal"].includes(choice.type)),
  );
  const ref = referenceValue(value);
  const reference =
    ref === null
      ? undefined
      : `${definition.nodes.find((node) => node.id === ref.nodeId)?.name ?? L.trigger} · ${ref.path.join(".") || L.types.record}`;
  const kind = type === "any" ? literalKind(value) : type;
  return (
    <>
      <BlockBindingField
        label={label}
        disabled={disabled}
        reference={reference}
        onVariable={() => setOpen(true)}
        onLiteral={() => onChange({ kind: "literal", value: "" })}
        help={help}
      >
        <div className="space-y-1.5">
          {type === "any" && (
            <Select
              ariaLabel={`${L.fields.type}: ${label}`}
              value={kind}
              disabled={disabled}
              options={["string", "number", "boolean", "array"].map((value) => ({
                value,
                label: L.types[value] ?? value,
              }))}
              onChange={(kind) =>
                onChange({
                  kind: "literal",
                  value:
                    kind === "number" ? 0 : kind === "boolean" ? false : kind === "array" ? [] : "",
                })
              }
            />
          )}
          <StudioLiteral {...props} type={kind} />
        </div>
      </BlockBindingField>
      <BlockVariablePicker
        open={open}
        onOpenChange={setOpen}
        choices={compatible}
        onChoose={(id) => {
          const chosen = references.get(id);
          if (chosen !== undefined) onChange(bindingFor(value, type, chosen));
        }}
        disabled={disabled}
      />
    </>
  );
}
