"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import type { BlockFieldDescriptor, BlockJson } from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { BlockField } from "@/features/blocks/ui/BlockField";
import { StudioCondition } from "./StudioCondition";
import { StudioBound, StudioFixed } from "./StudioFormControls";
import { StudioRecordPicker } from "./StudioRecordPicker";
import { StudioValue } from "./StudioValue";
import { fieldCatalog, type StudioFormProps } from "./studioFormTypes";
import { asObject, textValue } from "./studioModel";

function clearLoad(config: Record<string, BlockJson>) {
  const next = { ...config };
  delete next.loadField;
  delete next.loadRelation;
  return next;
}

function PickLoadField({
  node,
  studio,
  onChange,
  disabled,
  objectFields,
}: StudioFormProps & { objectFields: BlockFieldDescriptor[] }) {
  const L = useSharedBlocksMessages();
  const objectName = textValue(node.config.objectName);
  const choices = [
    ...objectFields
      .filter((field) => field.readable && field.type === "number")
      .map((field) => ({
        value: `field:${field.key}`,
        label: field.label,
        group: L.fields.loadField,
        config: { loadField: field.key },
      })),
    ...studio.objects.flatMap((object) =>
      object.fields
        .filter((field) => field.readable && field.referenceObject === objectName)
        .map((field) => ({
          value: `relation:${object.name}:${field.key}`,
          label: `${object.label} · ${field.label}`,
          group: L.fields.loadObject,
          config: { loadRelation: { objectName: object.name, field: field.key } },
        })),
    ),
  ];
  const loadRelation = asObject(node.config.loadRelation);
  const value =
    node.config.loadField === undefined
      ? `relation:${textValue(loadRelation.objectName)}:${textValue(loadRelation.field)}`
      : `field:${textValue(node.config.loadField)}`;
  const label = L.fields.balanceBy ?? "";
  return (
    <BlockField label={label}>
      <Select
        ariaLabel={label}
        value={value}
        disabled={disabled || choices.length === 0}
        options={choices}
        placeholder={L.fields.loadSelect}
        onChange={(selected) => {
          const choice = choices.find((option) => option.value === selected);
          if (choice !== undefined) onChange({ ...clearLoad(node.config), ...choice.config });
        }}
      />
    </BlockField>
  );
}

function NativeWriteValues(props: StudioFormProps) {
  const L = useSharedBlocksMessages();
  const [chosen, setChosen] = useState("");
  const fields = asObject(props.node.config.fields);
  const object = props.studio.objects.find(
    (item) => item.name === textValue(props.node.config.objectName),
  );
  const available =
    object?.fields.filter((field) =>
      props.node.type === "UPDATE_RECORD" ? field.updateable : field.createable,
    ) ?? [];
  return (
    <div className="space-y-4">
      {Object.entries(fields).map(([key, value]) => {
        const descriptor = available.find((field) => field.key === key);
        return (
          <div key={key} className="space-y-1">
            <StudioValue
              label={descriptor?.label ?? key}
              value={value}
              type={descriptor?.type ?? "string"}
              options={descriptor?.choices}
              definition={props.definition}
              nodeId={props.node.id}
              fields={fieldCatalog(props.studio)}
              disabled={props.disabled}
              onChange={(next) =>
                props.onChange({ ...props.node.config, fields: { ...fields, [key]: next } })
              }
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1 text-[10px] text-destructive"
              disabled={props.disabled}
              onClick={() => {
                const next = { ...fields };
                delete next[key];
                props.onChange({ ...props.node.config, fields: next });
              }}
            >
              {L.remove}
            </Button>
          </div>
        );
      })}
      <BlockField label={L.addField}>
        <Select
          ariaLabel={L.addField}
          value={chosen}
          disabled={props.disabled}
          options={[
            { value: "", label: L.addField },
            ...available
              .filter((field) => fields[field.key] === undefined)
              .map((field) => ({
                value: field.key,
                label: `${field.label}${field.required === true ? " *" : ""}`,
              })),
          ]}
          onChange={(key) => {
            if (key === "") return;
            props.onChange({
              ...props.node.config,
              fields: { ...fields, [key]: { kind: "literal", value: "" } },
            });
            setChosen("");
          }}
        />
      </BlockField>
    </div>
  );
}
export function StudioNativeFields(props: StudioFormProps) {
  const L = useSharedBlocksMessages();
  const { node, onChange, studio } = props;
  const config = node.config;
  const objectFields =
    studio.objects.find((object) => object.name === textValue(config.objectName))?.fields ?? [];
  return (
    <div className="space-y-4">
      <BlockField label={L.fields.objectName ?? ""}>
        <Select
          ariaLabel={L.fields.objectName ?? ""}
          value={textValue(config.objectName)}
          disabled={props.disabled}
          options={studio.objects.map((object) => ({ value: object.name, label: object.label }))}
          onChange={(objectName) =>
            onChange({
              ...(node.type === "PICK_RECORD" ? clearLoad(config) : config),
              objectName,
              fields: {},
              filters: [],
              recordId: { kind: "literal", value: "" },
              recordIds: [],
            })
          }
        />
      </BlockField>
      {["UPDATE_RECORD", "DELETE_RECORD"].includes(node.type) && <StudioRecordPicker {...props} />}
      {node.type === "UPSERT_RECORD" && (
        <>
          <StudioFixed
            {...props}
            name="matchField"
            label={L.fields.field}
            options={objectFields
              .filter((field) => field.upsertIdentity === true)
              .map((field) => ({ value: field.key, label: field.label }))}
          />
          <StudioBound {...props} name="matchValue" label={L.value} />
        </>
      )}
      {["CREATE_RECORD", "UPDATE_RECORD", "UPSERT_RECORD"].includes(node.type) && (
        <NativeWriteValues {...props} />
      )}
      {node.type === "FIND_RECORDS" && (
        <>
          <StudioCondition
            {...props}
            native
            value={config.filters ?? []}
            onChange={(filters) => onChange({ ...config, filters })}
          />
          <StudioFixed {...props} name="limit" numeric />
          <StudioFixed {...props} name="offset" numeric />
          <BlockField label={L.fields.sort ?? ""}>
            <Select
              ariaLabel={L.fields.sort ?? ""}
              value={textValue(asObject(config.sort).field)}
              disabled={props.disabled}
              options={[
                { value: "", label: L.fields.none ?? "" },
                ...objectFields
                  .filter((field) => field.readable)
                  .map((field) => ({ value: field.key, label: field.label })),
              ]}
              onChange={(field) =>
                onChange({
                  ...config,
                  sort: { field, direction: textValue(asObject(config.sort).direction) || "asc" },
                })
              }
            />
            <Select
              ariaLabel={L.fields.direction ?? ""}
              value={textValue(asObject(config.sort).direction) || "asc"}
              disabled={props.disabled}
              options={[
                { value: "asc", label: L.fields.asc ?? "" },
                { value: "desc", label: L.fields.desc ?? "" },
              ]}
              onChange={(direction) =>
                onChange({ ...config, sort: { ...asObject(config.sort), direction } })
              }
            />
          </BlockField>
        </>
      )}
      {node.type === "PICK_RECORD" && (
        <>
          <StudioRecordPicker {...props} multiple />
          <StudioFixed
            {...props}
            name="selectionMode"
            label={L.fields.strategy}
            options={["RANDOM", "ROUND_ROBIN", "LOAD_BALANCED"].map((value) => ({
              value,
              label: L.fields[value] ?? value,
            }))}
          />
          {config.selectionMode === "LOAD_BALANCED" && (
            <PickLoadField {...props} objectFields={objectFields} />
          )}
        </>
      )}
    </div>
  );
}
