"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { conditionSourceDefaults } from "../configurationSpec";
import type { ConfigurationIssue, ConfigurationMetadata } from "../configurationTypes";
import { mappingOptions } from "../mappingOptions";
import {
  type DraftBinding,
  draftBindingSchema,
  type WorkflowDefinition,
  type WorkflowNode,
} from "../schemas";
import { BindingField } from "./BindingField";
import { ConditionGroupFields } from "./ConditionGroupFields";
import { ConditionValue } from "./ConditionValue";
import { convertCondition } from "./conditionGroupEdits";

interface Props {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  errors?: Partial<Record<"left" | "right" | "operator", string>>;
  metadata?: ConfigurationMetadata;
  issues?: readonly ConfigurationIssue[];
}
export function ConditionFields(props: Props) {
  const t = useAppTranslations("workflows");
  const editable = props.editable && props.metadata?.status !== "denied";
  if (
    Object.hasOwn(props.node.config, "expression") ||
    Object.hasOwn(props.node.config, "defaultPort")
  )
    return <ConditionGroupFields {...props} />;
  const converted = convertCondition(props.node.config);
  return (
    <div className="space-y-4">
      <LegacyConditionFields {...props} editable={editable} />
      <Button
        variant="outline"
        disabled={!editable || converted === undefined}
        onClick={() => {
          if (editable && converted !== undefined)
            props.onChange({ ...props.node, config: converted });
        }}
      >
        {t("conditionConvert")}
      </Button>
    </div>
  );
}
function LegacyConditionFields({
  definition,
  node,
  editable,
  onChange,
  errors = {},
  metadata,
}: Props) {
  const t = useAppTranslations("workflows");
  const errorId = useId();
  const left = draftBindingSchema.safeParse(node.config.left);
  const choices = mappingOptions(definition, node.id, "scalar");
  const selected =
    left.success && left.data.kind === "reference"
      ? left.data.nodeId + "." + left.data.path.join(".")
      : "";
  const field = choices.find((choice) => choice.key === selected);
  const boolean = field?.type === "boolean";
  const status = field?.node.type === "record.read" && field.field === "status";
  const temporal = field?.type === "date" || field?.type === "instant";
  function update(config: WorkflowNode["config"]) {
    if (editable) onChange({ ...node, config: { ...node.config, ...config } });
  }
  function leftChanged(binding: DraftBinding) {
    const key = binding.kind === "reference" ? binding.nodeId + "." + binding.path.join(".") : "";
    const next = choices.find((choice) => choice.key === key);
    update({
      left: binding,
      ...conditionSourceDefaults({ type: next?.type, field: next?.field }),
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
        error={errors.left}
        path={["left"]}
        metadata={metadata}
      />
      <fieldset
        className="min-w-0 space-y-2"
        aria-label={t("conditionOperator")}
        aria-invalid={errors.operator !== undefined}
        aria-describedby={errors.operator === undefined ? undefined : errorId}
      >
        <p className="text-sm font-medium">{t("conditionOperator")}</p>
        <Select
          ariaLabel={t("conditionOperator")}
          value={operator}
          disabled={!editable}
          options={[
            { value: "equals", label: t("equals") },
            { value: "notEquals", label: t("notEquals") },
            { value: "exists", label: t("exists") },
            ...(!boolean && !status && !temporal
              ? [{ value: "contains", label: t("contains") }]
              : []),
          ]}
          onChange={(value) => update({ operator: value })}
        />
        {errors.operator !== undefined && (
          <p id={errorId} className="text-xs text-destructive">
            {errors.operator}
          </p>
        )}
      </fieldset>
      {operator !== "exists" && (
        <ConditionValue
          definition={definition}
          node={node}
          editable={editable}
          boolean={boolean}
          status={status}
          onChange={(right) => update({ right })}
          error={errors.right}
          metadata={metadata}
        />
      )}
    </div>
  );
}
