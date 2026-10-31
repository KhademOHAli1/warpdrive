"use client";
import { useId } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import {
  type Binding,
  bindingSchema,
  type WorkflowDefinition,
  type WorkflowNode,
} from "../schemas";
import { BindingField } from "./BindingField";
export function ConditionValue({
  definition,
  node,
  editable,
  boolean,
  status,
  onChange,
}: {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  boolean: boolean;
  status: boolean;
  onChange: (value: Binding) => void;
}) {
  const t = useAppTranslations("workflows");
  const sales = useAppTranslations("sales");
  const id = useId();
  const right = bindingSchema.safeParse(node.config.right);
  const valueChoices = boolean
    ? [
        { value: "true", label: t("boolTrue") },
        { value: "false", label: t("boolFalse") },
      ]
    : [
        { value: "open", label: sales("computed.statusOpen") },
        { value: "won", label: sales("computed.statusWon") },
        { value: "lost", label: sales("computed.statusLost") },
      ];
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {t("conditionValue")}
      </label>
      {right.success && right.data.kind === "reference" ? (
        <BindingField
          definition={definition}
          nodeId={node.id}
          value={right.data}
          onChange={onChange}
          kind="scalar"
          label={t("conditionValue")}
          sourceLabel={t("conditionValue")}
          editable={editable}
        />
      ) : boolean || status ? (
        <Select
          ariaLabel={t("conditionValue")}
          value={right.success && right.data.kind === "value" ? String(right.data.value ?? "") : ""}
          disabled={!editable}
          placeholder={t("chooseValue")}
          options={valueChoices}
          onChange={(value) =>
            onChange({ kind: "value", value: boolean ? value === "true" : value })
          }
        />
      ) : (
        <Input
          dir="auto"
          id={id}
          value={right.success && right.data.kind === "value" ? String(right.data.value ?? "") : ""}
          disabled={!editable}
          maxLength={255}
          onChange={(event) => onChange({ kind: "value", value: event.target.value })}
        />
      )}
    </div>
  );
}
