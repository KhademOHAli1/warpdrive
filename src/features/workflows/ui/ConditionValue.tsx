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

interface Props {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  boolean: boolean;
  status: boolean;
  onChange: (value: Binding) => void;
  error?: string;
}
function LiteralValue({
  node,
  editable,
  boolean,
  status,
  onChange,
  error,
  errorId,
}: Omit<Props, "definition"> & { errorId: string }) {
  const t = useAppTranslations("workflows");
  const sales = useAppTranslations("sales");
  const id = useId();
  const parsed = bindingSchema.safeParse(node.config.right);
  const value = parsed.success && parsed.data.kind === "value" ? parsed.data.value : "";
  const choices = boolean
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
      {boolean || status ? (
        <Select
          ariaLabel={t("conditionValue")}
          value={String(value ?? "")}
          disabled={!editable}
          options={choices}
          placeholder={t("chooseValue")}
          onChange={(value) =>
            onChange({ kind: "value", value: boolean ? value === "true" : value })
          }
        />
      ) : (
        <Input
          id={id}
          dir="auto"
          value={String(value ?? "")}
          disabled={!editable}
          maxLength={255}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : errorId}
          onChange={(event) => onChange({ kind: "value", value: event.target.value })}
        />
      )}
    </div>
  );
}
export function ConditionValue(props: Props) {
  const t = useAppTranslations("workflows");
  const defaultValue = props.boolean ? true : props.status ? "open" : "";
  return (
    <BindingField
      definition={props.definition}
      nodeId={props.node.id}
      value={props.node.config.right}
      onChange={props.onChange}
      kind="scalar"
      label={t("conditionValue")}
      sourceLabel={t("conditionValue") + " · " + t("configurationValueMode")}
      editable={props.editable}
      allowLiteral={false}
      allowNull
      nullLabel={t("configurationNullValue")}
      literalControlLabel={t("literalValue")}
      onSelectLiteral={() => props.onChange({ kind: "value", value: defaultValue })}
      error={props.error}
      literalControl={(errorId) => <LiteralValue {...props} errorId={errorId} />}
    />
  );
}
