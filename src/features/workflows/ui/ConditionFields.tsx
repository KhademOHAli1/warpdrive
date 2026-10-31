"use client";

import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { mappingOptions } from "../mappingOptions";
import {
  type Binding,
  bindingSchema,
  type WorkflowDefinition,
  type WorkflowNode,
} from "../schemas";
import { BindingField } from "./BindingField";
import { ConditionValue } from "./ConditionValue";

export function ConditionFields({
  definition,
  node,
  editable,
  onChange,
}: {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
}) {
  const t = useAppTranslations("workflows");
  const left = bindingSchema.safeParse(node.config.left);
  const choices = mappingOptions(definition, node.id, "scalar");
  const selected =
    left.success && left.data.kind === "reference"
      ? left.data.nodeId + "." + left.data.path.join(".")
      : "";
  const field = choices.find((choice) => choice.key === selected);
  const boolean = field?.type === "boolean";
  const status = field?.node.type === "record.read" && field.field === "status";
  function update(config: WorkflowNode["config"]) {
    onChange({ ...node, config: { ...node.config, ...config } });
  }
  function leftChanged(binding: Binding) {
    const key = binding.kind === "reference" ? binding.nodeId + "." + binding.path.join(".") : "";
    const next = choices.find((choice) => choice.key === key);
    const defaultValue = next?.type === "boolean" ? true : next?.field === "status" ? "open" : "";
    update({
      left: binding,
      right: { kind: "value", value: defaultValue },
      operator: "equals",
    });
  }
  const operator = typeof node.config.operator === "string" ? node.config.operator : "equals";
  return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-muted-foreground">{t("conditionActionHint")}</p>
      <BindingField
        definition={definition}
        nodeId={node.id}
        value={node.config.left}
        onChange={leftChanged}
        kind="scalar"
        label={t("conditionField")}
        sourceLabel={t("conditionField")}
        editable={editable}
        allowLiteral={false}
      />
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("conditionOperator")}</p>
        <Select
          ariaLabel={t("conditionOperator")}
          value={operator}
          disabled={!editable}
          options={[
            { value: "equals", label: t("equals") },
            { value: "notEquals", label: t("notEquals") },
            { value: "exists", label: t("exists") },
            ...(!boolean && !status ? [{ value: "contains", label: t("contains") }] : []),
          ]}
          onChange={(value) => update({ operator: value })}
        />
      </div>
      {operator !== "exists" && (
        <ConditionValue
          definition={definition}
          node={node}
          editable={editable}
          boolean={boolean}
          status={status}
          onChange={(right) => update({ right })}
        />
      )}
    </div>
  );
}
