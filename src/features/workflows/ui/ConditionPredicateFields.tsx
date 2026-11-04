"use client";
import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { describeConditionPredicate } from "../conditionMapping";
import type { ConfigurationIssue } from "../configurationTypes";
import { type DraftBinding, draftBindingSchema, type WorkflowNode } from "../schemas";
import { BindingField } from "./BindingField";
import type { ConditionGroupProps } from "./ConditionGroupFields";
import { ConditionValue } from "./ConditionValue";
import {
  type ConditionObject,
  editCondition,
  moveCondition,
  newConditionEntry,
} from "./conditionGroupEdits";
import { configurationIssueKeys } from "./configurationIssueMessage";

interface Props extends ConditionGroupProps {
  entry: ConditionObject;
  indices: readonly number[];
  ordinals: readonly number[];
  siblingCount: number;
  onRemoved: () => void;
}
function samePath(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}
function operandPath(indices: readonly number[], operand: string) {
  return ["expression", ...indices.flatMap((index) => ["children", String(index)]), operand];
}
function nullLiteral(raw: unknown) {
  const value = draftBindingSchema.safeParse(raw);
  return value.success && value.data.kind === "value" && value.data.value === null;
}
function predicateOperators(kind: string | undefined, raw: unknown) {
  const basic = ["equals", "notEquals", "exists"] as const;
  if (kind === "text") return [...basic, "isEmpty", "contains"] as const;
  if (kind === "decimal") return [...basic, "contains"] as const;
  return nullLiteral(raw) ? ([...basic, "isEmpty"] as const) : basic;
}
export function ConditionPredicateFields(props: Props) {
  const { node, definition, entry, indices, ordinals, editable, onChange, metadata } = props;
  const t = useAppTranslations("workflows");
  const format = useFormatters();
  const operatorErrorId = useId();
  const id = typeof entry.id === "string" ? entry.id : undefined;
  const described =
    id === undefined ? undefined : describeConditionPredicate(definition, node.id, id, metadata);
  const plan = described?.ok === true ? described.value : undefined;
  const issues = [...(props.issues ?? []), ...(plan?.issues ?? [])];
  const operator = typeof entry.operator === "string" ? entry.operator : "";
  const kind = plan?.left.inspection.source?.contract.kind ?? plan?.left.literalContract?.kind;
  function errorFor(operand: string) {
    const issue = issues.find(
      (item: ConfigurationIssue) =>
        item.nodeId === node.id && samePath(item.path, operandPath(indices, operand)),
    );
    return issue === undefined ? undefined : t(configurationIssueKeys[issue.code]);
  }
  function commit(config: WorkflowNode["config"] | undefined) {
    if (editable && config !== undefined) onChange({ ...node, config });
  }
  function change(operand: string, value: DraftBinding | string) {
    commit(
      editCondition(node.config, indices, id, (current) => ({ ...current, [operand]: value })),
    );
  }
  const selection = id === undefined ? undefined : { predicateId: id, onChange };
  const name = t("conditionRow") + " " + ordinals.map((part) => format.number(part)).join(".");
  return (
    <fieldset aria-label={name} className="min-w-0 space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{name}</legend>
      <BindingField
        definition={definition}
        nodeId={node.id}
        value={entry.left}
        onChange={(left) => change("left", left)}
        kind="scalar"
        label={t("conditionField")}
        sourceLabel={t("conditionField")}
        editable={editable && id !== undefined}
        allowLiteral
        target={plan?.left.target}
        path={operandPath(indices, "left")}
        metadata={metadata}
        error={errorFor("left")}
        conditionSelection={selection}
      />
      <fieldset
        aria-label={t("conditionOperator")}
        aria-invalid={errorFor("operator") !== undefined}
        aria-describedby={errorFor("operator") === undefined ? undefined : operatorErrorId}
        className="min-w-0 space-y-1"
      >
        <Select
          ariaLabel={t("conditionOperator")}
          disabled={!editable}
          value={operator}
          options={predicateOperators(kind, entry.left).map((value) => ({
            value,
            label: t(value),
          }))}
          onChange={(value) => {
            if (predicateOperators(kind, entry.left).some((allowed) => allowed === value))
              change("operator", value);
          }}
        />
        {errorFor("operator") !== undefined && (
          <p id={operatorErrorId} className="text-xs text-destructive">
            {errorFor("operator")}
          </p>
        )}
      </fieldset>
      {operator !== "exists" && operator !== "isEmpty" && (
        <ConditionValue
          definition={definition}
          node={node}
          editable={editable && id !== undefined}
          boolean={plan?.right?.target.contract.kind === "boolean"}
          status={plan?.left.inspection.source?.field === "status"}
          onChange={(right) => change("right", right)}
          error={errorFor("right")}
          metadata={metadata}
          rawValue={entry.right}
          operandPath={operandPath(indices, "right")}
          target={plan?.right?.target}
          conditionSelection={selection}
        />
      )}
      {(id === undefined || entry.kind !== "predicate") && (
        <Button
          disabled={!editable}
          onClick={() =>
            commit(
              editCondition(node.config, indices, id, (current) => ({
                ...current,
                kind: "predicate",
                id: id ?? newConditionEntry(node.config, "predicate").id,
              })),
            )
          }
        >
          {t("conditionRepair")}
        </Button>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={!editable || indices.at(-1) === 0}
          onClick={() => commit(moveCondition(node.config, indices, id, -1))}
        >
          {t("conditionEarlier")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!editable || indices.at(-1) === props.siblingCount - 1}
          onClick={() => commit(moveCondition(node.config, indices, id, 1))}
        >
          {t("conditionLater")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!editable}
          onClick={() => {
            commit(editCondition(node.config, indices, id, () => undefined));
            props.onRemoved();
          }}
        >
          {t("conditionRemove")}
        </Button>
      </div>
    </fieldset>
  );
}
