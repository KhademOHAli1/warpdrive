"use client";
import { useId } from "react";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { ConfigurationMetadata } from "../configurationTypes";
import { describeMappingTarget } from "../mappingCatalog";
import type { MappingTarget } from "../mappingTypes";
import {
  type DraftBinding,
  type DraftValueBinding,
  draftBindingSchema,
  type WorkflowDefinition,
  type WorkflowNode,
} from "../schemas";
import { BindingField, type ConditionBindingSelection } from "./BindingField";
import { TypedLiteralValue } from "./TypedLiteralValue";

interface Props {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  boolean: boolean;
  status: boolean;
  onChange: (value: DraftBinding) => void;
  error?: string;
  metadata?: ConfigurationMetadata;
  rawValue?: unknown;
  operandPath?: readonly string[];
  target?: MappingTarget;
  conditionSelection?: ConditionBindingSelection;
}
function rawValue(props: Props) {
  return props.operandPath === undefined ? props.node.config.right : props.rawValue;
}
function emptyLiteral(props: Props, target: MappingTarget | undefined): DraftValueBinding {
  const kind = target?.contract.kind;
  if (kind === "number" || kind === "date" || kind === "instant")
    return { kind: "value", value: "", literalType: kind };
  return { kind: "value", value: props.boolean ? true : props.status ? "open" : "" };
}
function LiteralValue({
  errorId,
  target,
  ...props
}: Omit<Props, "target"> & { errorId: string; target: MappingTarget | undefined }) {
  const t = useAppTranslations("workflows");
  const sales = useAppTranslations("sales");
  const id = useId();
  const parsed = draftBindingSchema.safeParse(rawValue(props));
  const binding =
    parsed.success && parsed.data.kind === "value" ? parsed.data : emptyLiteral(props, target);
  const choices = props.boolean
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
      {props.boolean || props.status ? (
        <Select
          ariaLabel={t("conditionValue")}
          value={String(binding.value ?? "")}
          disabled={!props.editable}
          options={choices}
          placeholder={t("chooseValue")}
          onChange={(value) => {
            if (props.editable)
              props.onChange({ kind: "value", value: props.boolean ? value === "true" : value });
          }}
        />
      ) : (
        <TypedLiteralValue
          id={id}
          binding={binding}
          target={target}
          label={t("conditionValue")}
          editable={props.editable}
          error={props.error}
          errorId={errorId}
          hideError
          onChange={props.onChange}
        />
      )}
    </div>
  );
}
export function ConditionValue(props: Props) {
  const t = useAppTranslations("workflows");
  const described = describeMappingTarget(
    props.definition,
    props.node.id,
    props.operandPath ?? ["right"],
    props.metadata,
  );
  const target = props.target ?? (described.state === "ready" ? described.target : undefined);
  return (
    <BindingField
      definition={props.definition}
      nodeId={props.node.id}
      value={rawValue(props)}
      onChange={props.onChange}
      kind="scalar"
      label={t("conditionValue")}
      sourceLabel={t("conditionValue") + " · " + t("configurationValueMode")}
      editable={props.editable}
      allowLiteral={false}
      allowNull
      nullLabel={t("configurationNullValue")}
      literalControlLabel={t("literalValue")}
      onSelectLiteral={() => {
        if (props.editable) props.onChange(emptyLiteral(props, target));
      }}
      error={props.error}
      target={target}
      path={props.operandPath ?? ["right"]}
      metadata={props.metadata}
      conditionSelection={props.conditionSelection}
      literalControl={(errorId) => <LiteralValue {...props} target={target} errorId={errorId} />}
    />
  );
}
