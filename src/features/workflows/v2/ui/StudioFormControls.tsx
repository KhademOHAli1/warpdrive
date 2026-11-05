"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { BlockJson } from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { BlockField } from "@/features/blocks/ui/BlockField";
import { StudioValue } from "./StudioValue";
import { fieldCatalog, type StudioFormProps } from "./studioFormTypes";
import { asObject, textValue } from "./studioModel";

export function StudioBound({
  name,
  label,
  type,
  multiline,
  options,
  ...props
}: StudioFormProps & {
  name: string;
  label?: string;
  type?: string;
  multiline?: boolean;
  options?: { value: string; label: string }[];
}) {
  const L = useSharedBlocksMessages();
  return (
    <StudioValue
      label={label ?? L.fields[name] ?? name}
      value={props.node.config[name]}
      type={type}
      multiline={multiline}
      options={options}
      definition={props.definition}
      nodeId={props.node.id}
      fields={fieldCatalog(props.studio)}
      disabled={props.disabled}
      onChange={(value) => props.onChange({ ...props.node.config, [name]: value })}
    />
  );
}
export function StudioFixed({
  name,
  label,
  options,
  numeric = false,
  ...props
}: StudioFormProps & {
  name: string;
  label?: string;
  options?: { value: string; label: string }[];
  numeric?: boolean;
}) {
  const L = useSharedBlocksMessages();
  const title = label ?? L.fields[name] ?? name;
  return (
    <BlockField label={title}>
      {options === undefined ? (
        <Input
          aria-label={title}
          disabled={props.disabled}
          type={numeric ? "number" : "text"}
          value={textValue(props.node.config[name])}
          onChange={(event) =>
            props.onChange({
              ...props.node.config,
              [name]:
                numeric && event.target.value !== ""
                  ? Number(event.target.value)
                  : event.target.value,
            })
          }
          className="h-9 text-xs"
        />
      ) : (
        <Select
          ariaLabel={title}
          value={textValue(props.node.config[name])}
          disabled={props.disabled}
          options={options}
          onChange={(value) => props.onChange({ ...props.node.config, [name]: value })}
        />
      )}
    </BlockField>
  );
}
export function StudioToggle({
  name,
  label,
  ...props
}: StudioFormProps & { name: string; label?: string }) {
  const L = useSharedBlocksMessages();
  const title = label ?? L.fields[name] ?? name;
  return (
    <BlockField label={title}>
      <Select
        ariaLabel={title}
        disabled={props.disabled}
        value={props.node.config[name] === true ? "true" : "false"}
        options={[
          { value: "true", label: L.true },
          { value: "false", label: L.false },
        ]}
        onChange={(value) => props.onChange({ ...props.node.config, [name]: value === "true" })}
      />
    </BlockField>
  );
}
export function StudioKeyValues({
  name,
  label,
  ...props
}: StudioFormProps & { name: string; label?: string }) {
  const L = useSharedBlocksMessages();
  const [draft, setDraft] = useState("");
  const values = asObject(props.node.config[name]);
  function replace(key: string, value: BlockJson) {
    props.onChange({ ...props.node.config, [name]: { ...values, [key]: value } });
  }
  return (
    <BlockField label={label ?? L.fields[name] ?? name}>
      <div className="space-y-3">
        {Object.entries(values).map(([key, value]) => (
          <div key={key} className="flex items-end gap-1">
            <div className="min-w-0 flex-1">
              <StudioValue
                label={key}
                value={value}
                definition={props.definition}
                nodeId={props.node.id}
                fields={fieldCatalog(props.studio)}
                disabled={props.disabled}
                onChange={(next) => replace(key, next)}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="size-8 shrink-0 p-0"
              aria-label={`${L.remove}: ${key}`}
              disabled={props.disabled}
              onClick={() => {
                const next = { ...values };
                delete next[key];
                props.onChange({ ...props.node.config, [name]: next });
              }}
            >
              ×
            </Button>
          </div>
        ))}
        <div className="flex gap-1.5">
          <Input
            aria-label={L.fields.parameter}
            placeholder={L.fields.parameter}
            value={draft}
            disabled={props.disabled}
            onChange={(event) => setDraft(event.target.value)}
            className="h-8 text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={
              props.disabled ||
              draft.trim() === "" ||
              ["__proto__", "constructor", "prototype"].includes(draft.trim())
            }
            onClick={() => {
              replace(draft.trim(), { kind: "literal", value: "" });
              setDraft("");
            }}
          >
            {L.addField}
          </Button>
        </div>
      </div>
    </BlockField>
  );
}
export function StudioSchemaFields({ name, ...props }: StudioFormProps & { name: string }) {
  const L = useSharedBlocksMessages();
  const [key, setKey] = useState("");
  const schema = asObject(props.node.config[name]);
  const fields = asObject(schema.properties);
  function update(next: Record<string, BlockJson>) {
    const config = { ...props.node.config };
    const keys = Object.keys(next);
    if (keys.length === 0) delete config[name];
    else
      config[name] = {
        type: "object",
        properties: next,
        required: keys,
        additionalProperties: false,
      };
    props.onChange(config);
  }
  return (
    <BlockField label={L.fields.outputSchema ?? ""}>
      <div className="space-y-2">
        {Object.entries(fields).map(([field, value]) => (
          <div key={field} className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-xs">{field}</span>
            <div className="w-28">
              <Select
                ariaLabel={`${L.fields.type}: ${field}`}
                value={textValue(asObject(value).type)}
                options={["string", "number", "boolean", "object", "array"].map((type) => ({
                  value: type,
                  label: L.types[type] ?? type,
                }))}
                disabled={props.disabled}
                onChange={(type) => update({ ...fields, [field]: { type } })}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${L.remove}: ${field}`}
              disabled={props.disabled}
              onClick={() => {
                const next = { ...fields };
                delete next[field];
                update(next);
              }}
            >
              ×
            </Button>
          </div>
        ))}
        <div className="flex gap-1.5">
          <Input
            aria-label={L.fields.name}
            value={key}
            disabled={props.disabled}
            onChange={(event) => setKey(event.target.value)}
            className="h-8 text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={props.disabled || !/^[a-zA-Z][a-zA-Z0-9_]*$/u.test(key)}
            onClick={() => {
              update({ ...fields, [key]: { type: "string" } });
              setKey("");
            }}
          >
            {L.addField}
          </Button>
        </div>
      </div>
    </BlockField>
  );
}
