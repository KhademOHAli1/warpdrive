"use client";
import { useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { parseConditionConfig } from "../conditionExpression";
import { rawConditionGroup } from "../conditionExpressionBudget";
import type { ConfigurationIssue, ConfigurationMetadata } from "../configurationTypes";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { ConditionPredicateFields } from "./ConditionPredicateFields";
import {
  appendCondition,
  type ConditionObject,
  conditionChildren,
  conditionObject,
  conditionRoot,
  editCondition,
  moveCondition,
  newConditionEntry,
} from "./conditionGroupEdits";
export interface ConditionGroupProps {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  metadata?: ConfigurationMetadata;
  issues?: readonly ConfigurationIssue[];
  showOtherwise?: boolean;
}
interface GroupProps extends ConditionGroupProps {
  entry: ConditionObject;
  indices: readonly number[];
  ordinals: readonly number[];
  parentSize?: number;
  onRemoved?: () => void;
}
function identity(entry: ConditionObject) {
  return typeof entry.id === "string" ? entry.id : undefined;
}
function GroupRow(props: GroupProps) {
  const { entry, node, indices, ordinals, editable, onChange } = props;
  const t = useAppTranslations("workflows");
  const format = useFormatters();
  const add = useRef<HTMLButtonElement>(null);
  const id = identity(entry);
  const rows = conditionChildren(entry);
  const canAdd = appendCondition(node.config, indices, id, "predicate") !== undefined;
  const canNest = appendCondition(node.config, indices, id, "group") !== undefined;
  const name = t("conditionGroup") + " " + ordinals.map((part) => format.number(part)).join(".");
  function commit(config: WorkflowNode["config"] | undefined) {
    if (editable && config !== undefined) onChange({ ...node, config });
  }
  function restore() {
    queueMicrotask(() => add.current?.focus());
  }
  return (
    <fieldset aria-label={name} className="min-w-0 space-y-4 rounded-lg border p-3">
      <legend className="px-1 text-sm font-semibold">{name}</legend>
      <Select
        ariaLabel={t("conditionMatch")}
        disabled={!editable}
        value={typeof entry.operator === "string" ? entry.operator : ""}
        placeholder={t("chooseValue")}
        options={[
          { value: "and", label: t("conditionAll") },
          { value: "or", label: t("conditionAny") },
        ]}
        onChange={(operator) => {
          if (operator === "and" || operator === "or")
            commit(
              editCondition(node.config, indices, id, (current) => ({ ...current, operator })),
            );
        }}
      />
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("conditionOmitted")}</p>
      )}
      {rows.map((raw, index) => {
        const child = conditionObject(raw);
        if (child === undefined) return null;
        const childIndices = [...indices, index];
        const childOrdinals = [...ordinals, index + 1];
        const key = identity(child) ?? childIndices.join(".");
        return rawConditionGroup(child) ? (
          <GroupRow
            key={key}
            {...props}
            entry={child}
            indices={childIndices}
            ordinals={childOrdinals}
            parentSize={rows.length}
            onRemoved={restore}
          />
        ) : (
          <ConditionPredicateFields
            key={key}
            {...props}
            entry={child}
            indices={childIndices}
            ordinals={childOrdinals}
            siblingCount={rows.length}
            onRemoved={restore}
          />
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button
          ref={add}
          size="sm"
          variant="outline"
          disabled={!editable || !canAdd}
          onClick={() => commit(appendCondition(node.config, indices, id, "predicate"))}
        >
          {t("conditionAdd")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!editable || !canNest}
          onClick={() => commit(appendCondition(node.config, indices, id, "group"))}
        >
          {t("conditionAddGroup")}
        </Button>
      </div>
      {(!canAdd || !canNest) && (
        <p className="text-xs text-muted-foreground">{t("conditionLimit")}</p>
      )}
      {(id === undefined || entry.kind !== "group") && (
        <Button
          disabled={!editable}
          onClick={() =>
            commit(
              editCondition(node.config, indices, id, (current) => ({
                ...current,
                kind: "group",
                id: id ?? newConditionEntry(node.config, "group").id,
              })),
            )
          }
        >
          {t("conditionRepair")}
        </Button>
      )}
      {indices.length > 0 && (
        <div className="flex gap-2">
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
            disabled={!editable || indices.at(-1) === (props.parentSize ?? 0) - 1}
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
              props.onRemoved?.();
            }}
          >
            {t("conditionRemoveGroup")}
          </Button>
        </div>
      )}
    </fieldset>
  );
}
export function ConditionGroupFields(props: ConditionGroupProps) {
  const t = useAppTranslations("workflows");
  const otherwise = t(props.node.type === "filter" ? "filterActionHint" : "conditionOtherwise");
  const root = conditionRoot(props.node.config);
  const editable = props.editable && props.metadata?.status !== "denied";
  const parsed = parseConditionConfig(props.node.config, "draft");
  if (root === undefined)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          {t("conditionInvalid")}
        </p>
        {parsed.ok && parsed.value.kind === "grouped" && (
          <Button
            disabled={!editable}
            onClick={() => {
              if (editable)
                props.onChange({
                  ...props.node,
                  config: {
                    ...props.node.config,
                    expression: newConditionEntry(props.node.config, "group"),
                  },
                });
            }}
          >
            {t("conditionRepair")}
          </Button>
        )}
      </div>
    );
  return (
    <div className="space-y-4">
      <GroupRow {...props} editable={editable} entry={root} indices={[]} ordinals={[1]} />
      {props.showOtherwise !== false && (
        <>
          <p className="text-xs text-muted-foreground">
            {props.node.config.defaultPort === "false"
              ? otherwise
              : t("conditionOmitted") + ": " + otherwise}
          </p>
          {props.node.config.defaultPort !== "false" && (
            <Button
              disabled={!editable}
              onClick={() => {
                if (editable)
                  props.onChange({
                    ...props.node,
                    config: { ...props.node.config, defaultPort: "false" },
                  });
              }}
            >
              {t(props.node.type === "filter" ? "filterUseDefault" : "conditionUseDefault")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
