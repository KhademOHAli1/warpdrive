"use client";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import type { BlockJson } from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { BlockField } from "@/features/blocks/ui/BlockField";
import { StudioValue } from "./StudioValue";
import { fieldCatalog, type StudioFormProps } from "./studioFormTypes";
import { asArray, asObject, emptyCondition, textValue } from "./studioModel";
import { useDraftRowKeys } from "./useDraftRowKeys";

export function StudioCondition({
  value,
  onChange,
  native = false,
  depth = 0,
  ...props
}: StudioFormProps & {
  value: BlockJson | undefined;
  onChange: (value: BlockJson) => void;
  native?: boolean;
  depth?: number;
}) {
  const L = useSharedBlocksMessages();
  const condition = asObject(value);
  const grouped = condition.combinator === "and" || condition.combinator === "or";
  const conditions = Array.isArray(value) ? value : asArray(condition.conditions);
  const rowKeys = useDraftRowKeys(conditions.length);
  const nativeFields =
    props.studio.objects
      .find((object) => object.name === textValue(props.node.config.objectName))
      ?.fields.filter((field) => field.readable) ?? [];
  if (grouped || Array.isArray(value)) {
    function update(children: BlockJson[]) {
      onChange({ combinator: condition.combinator === "or" ? "or" : "and", conditions: children });
    }
    return (
      <div className="space-y-3 border-s ps-3">
        <Select
          ariaLabel={L.fields.operator ?? ""}
          value={condition.combinator === "or" ? "or" : "and"}
          disabled={props.disabled}
          options={[
            { value: "and", label: L.fields.and ?? "" },
            { value: "or", label: L.fields.or ?? "" },
          ]}
          onChange={(combinator) => onChange({ combinator, conditions })}
        />
        {rowKeys.keys.map((key, index) => (
          <div key={key} className="space-y-2 border-t pt-3">
            <StudioCondition
              {...props}
              native={native}
              depth={depth + 1}
              value={conditions[index]}
              onChange={(next) =>
                update(conditions.map((item, childIndex) => (childIndex === index ? next : item)))
              }
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={props.disabled}
              className="h-7 px-1 text-xs text-destructive"
              onClick={() => {
                rowKeys.remove(index);
                update(conditions.filter((_, childIndex) => childIndex !== index));
              }}
            >
              {L.remove}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={props.disabled || conditions.length >= 40}
            onClick={() =>
              update([
                ...conditions,
                native
                  ? {
                      field: nativeFields[0]?.key ?? "id",
                      operator: "eq",
                      value: { kind: "literal", value: "" },
                    }
                  : {
                      left: { kind: "literal", value: "" },
                      operator: "eq",
                      right: { kind: "literal", value: "" },
                    },
              ])
            }
          >
            {L.addRule}
          </Button>
          {depth < 4 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={props.disabled}
              onClick={() =>
                update([
                  ...conditions,
                  native ? { combinator: "and", conditions: [] } : emptyCondition(),
                ])
              }
            >
              {L.fields.and}
            </Button>
          )}
        </div>
      </div>
    );
  }
  const field = nativeFields.find((item) => item.key === textValue(condition.field));
  const operator = textValue(condition.operator) || "eq";
  const operators = field?.filterOperators ?? [
    "eq",
    "ne",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "starts_with",
    "in",
    "is_empty",
    "is_not_empty",
  ];
  return (
    <div className="space-y-3">
      {native ? (
        <BlockField label={L.field}>
          <Select
            ariaLabel={L.field}
            value={textValue(condition.field)}
            disabled={props.disabled}
            options={nativeFields.map((item) => ({ value: item.key, label: item.label }))}
            onChange={(key) => onChange({ ...condition, field: key })}
          />
        </BlockField>
      ) : (
        <StudioValue
          label={L.field}
          value={condition.left}
          definition={props.definition}
          nodeId={props.node.id}
          fields={fieldCatalog(props.studio)}
          disabled={props.disabled}
          type="any"
          onChange={(left) => onChange({ ...condition, left })}
        />
      )}
      <BlockField label={L.fields.operator ?? ""}>
        <Select
          ariaLabel={L.fields.operator ?? ""}
          value={operator}
          disabled={props.disabled}
          options={operators.map((value) => ({ value, label: L.operators[value] ?? value }))}
          onChange={(next) => onChange({ ...condition, operator: next })}
        />
      </BlockField>
      {!["is_empty", "is_not_empty"].includes(operator) && (
        <StudioValue
          label={L.value}
          value={condition[native ? "value" : "right"]}
          definition={props.definition}
          nodeId={props.node.id}
          fields={fieldCatalog(props.studio)}
          disabled={props.disabled}
          type={native ? (field?.type ?? "string") : "any"}
          onChange={(right) => onChange({ ...condition, [native ? "value" : "right"]: right })}
        />
      )}
    </div>
  );
}
