"use client";

import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { ConfigurationMetadata, ConfigurationValidation } from "../configurationTypes";
import type { DraftBinding, WorkflowDefinition, WorkflowNode } from "../schemas";
import { recordSearchDepthMax, recordSearchEntryMax } from "../workflowRecordQueryBounds";
import {
  type RecordLookupEntity,
  type RecordSearchDraftConfig,
  type RecordSearchField,
  type RecordSearchFilterCondition,
  type RecordSearchFilterEntry,
  type RecordSearchFilterGroup,
  recordLookupEntities,
  recordLookupEntitySchema,
  recordSearchBindingTarget,
  recordSearchDraftConfig,
  recordSearchFieldContract,
  recordSearchFields,
  recordSearchOperatorNeedsValue,
  recordSearchOperators,
  recordSearchPrimary,
} from "../workflowRecordQueryContract";
import { BindingField } from "./BindingField";
import { configurationIssueKeys } from "./configurationIssueMessage";
import { RecordQuerySelect } from "./RecordQuerySelect";
import { useRecordQueryCopy } from "./recordQueryCopy";
import styles from "./workflowInspector.module.css";

interface Props {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  validation: ConfigurationValidation;
  metadata: ConfigurationMetadata;
}
type SearchDraft = RecordSearchDraftConfig & { entity: RecordLookupEntity };
type FormContext = Omit<Props, "onChange" | "validation"> & {
  draft: SearchDraft;
  errorFor: (path: readonly string[]) => string | undefined;
};

function blankOperand(entity: RecordLookupEntity, field: RecordSearchField): DraftBinding {
  const { kind } = recordSearchFieldContract(entity, field);
  if (kind === "boolean") return { kind: "value", value: false };
  if (kind === "date" || kind === "instant") return { kind: "value", value: "", literalType: kind };
  return { kind: "value", value: "" };
}

function newCondition(entity: RecordLookupEntity): RecordSearchFilterCondition {
  const field = recordSearchPrimary[entity];
  return {
    kind: "condition",
    id: crypto.randomUUID(),
    field,
    operator: "equals",
    value: blankOperand(entity, field),
  };
}

function newGroup(entity: RecordLookupEntity): RecordSearchFilterGroup {
  return {
    kind: "group",
    id: crypto.randomUUID(),
    combinator: "and",
    entries: [newCondition(entity)],
  };
}

function entryCount(entry: RecordSearchFilterEntry): number {
  return entry.kind === "condition"
    ? 1
    : 1 + entry.entries.reduce((sum, child) => sum + entryCount(child), 0);
}

function ConditionFields({
  context,
  entry,
  path,
  onChange,
}: {
  context: FormContext;
  entry: RecordSearchFilterCondition;
  path: readonly string[];
  onChange: (entry: RecordSearchFilterCondition) => void;
}) {
  const copy = useRecordQueryCopy();
  const { draft, editable, node, definition, metadata, errorFor } = context;
  const operators = recordSearchOperators(draft.entity, entry.field);
  const targetPath = [...path, "value"];
  const target = recordSearchBindingTarget(node.id, draft, targetPath);
  const issue = errorFor(targetPath);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <RecordQuerySelect
          label={copy.field}
          value={entry.field}
          editable={editable}
          options={recordSearchFields[draft.entity].map((field) => ({
            value: field,
            label: copy.fields[field],
          }))}
          onChange={(value) => {
            const field = recordSearchFields[draft.entity].find((candidate) => candidate === value);
            if (editable && field !== undefined && field !== entry.field)
              onChange({
                ...entry,
                field,
                operator: "equals",
                value: blankOperand(draft.entity, field),
              });
          }}
        />
        <RecordQuerySelect
          label={copy.operator}
          value={entry.operator}
          editable={editable}
          options={operators.map((value) => ({ value, label: copy.operators[value] }))}
          onChange={(value) => {
            const operator = operators.find((candidate) => candidate === value);
            if (!editable || operator === undefined || operator === entry.operator) return;
            const { value: previous, ...condition } = entry;
            onChange({
              ...condition,
              operator,
              ...(recordSearchOperatorNeedsValue(operator)
                ? { value: previous ?? blankOperand(draft.entity, entry.field) }
                : {}),
            });
          }}
        />
      </div>
      {target === undefined ? (
        issue === undefined ? null : (
          <p className="text-xs text-destructive">{issue}</p>
        )
      ) : (
        <BindingField
          definition={definition}
          nodeId={node.id}
          editable={editable}
          kind="scalar"
          target={target}
          metadata={metadata}
          label={copy.value}
          sourceLabel={copy.source}
          maxLength={255}
          value={entry.value ?? blankOperand(draft.entity, entry.field)}
          error={issue}
          onChange={(binding) => {
            const kind = target.contract.kind;
            const value =
              binding.kind === "value" &&
              typeof binding.value === "string" &&
              (kind === "date" || kind === "instant")
                ? { ...binding, literalType: kind }
                : binding;
            if (editable) onChange({ ...entry, value });
          }}
        />
      )}
    </div>
  );
}

function FilterFields({
  context,
  group,
  depth,
  path,
  count,
  onChange,
}: {
  context: FormContext;
  group: RecordSearchFilterGroup;
  depth: number;
  path: readonly string[];
  count: number;
  onChange: (group: RecordSearchFilterGroup | undefined) => void;
}) {
  const copy = useRecordQueryCopy();
  const { editable, draft } = context;
  function changeEntry(index: number, next: RecordSearchFilterEntry | undefined) {
    const entries = group.entries.flatMap((entry, cursor) =>
      cursor === index ? (next === undefined ? [] : [next]) : [entry],
    );
    onChange(entries.length === 0 ? undefined : { ...group, entries });
  }
  return (
    <div className="min-w-0 space-y-2 rounded-md border border-border p-2">
      <RecordQuerySelect
        label={copy.filter}
        value={group.combinator}
        editable={editable}
        options={[
          { value: "and", label: copy.all },
          { value: "or", label: copy.any },
        ]}
        onChange={(combinator) => {
          if (
            editable &&
            (combinator === "and" || combinator === "or") &&
            combinator !== group.combinator
          )
            onChange({ ...group, combinator });
        }}
      />
      {group.entries.map((entry, index) => {
        const entryPath = [...path, "entries", String(index)];
        return (
          <div key={entry.id} className="min-w-0 space-y-1">
            {entry.kind === "group" ? (
              <FilterFields
                context={context}
                group={entry}
                depth={depth + 1}
                path={entryPath}
                count={count}
                onChange={(next) => changeEntry(index, next)}
              />
            ) : (
              <ConditionFields
                context={context}
                entry={entry}
                path={entryPath}
                onChange={(next) => changeEntry(index, next)}
              />
            )}
            {editable && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => changeEntry(index, undefined)}
              >
                {copy.remove}
              </Button>
            )}
          </div>
        );
      })}
      {editable && (
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={count >= recordSearchEntryMax}
            onClick={() =>
              onChange({ ...group, entries: [...group.entries, newCondition(draft.entity)] })
            }
          >
            {copy.addFilter}
          </Button>
          {depth < recordSearchDepthMax && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={count + 2 > recordSearchEntryMax}
              onClick={() =>
                onChange({ ...group, entries: [...group.entries, newGroup(draft.entity)] })
              }
            >
              {copy.addGroup}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function SortFields({
  context,
  onChange,
}: {
  context: FormContext;
  onChange: (orderBy: NonNullable<SearchDraft["orderBy"]>) => void;
}) {
  const copy = useRecordQueryCopy();
  const { editable, draft } = context;
  const sorts = draft.orderBy ?? [];
  const choices = recordSearchFields[draft.entity];
  const unused = choices.filter((field) => sorts.every((sort) => sort.field !== field));
  const next = unused.find((field) => field === recordSearchPrimary[draft.entity]) ?? unused[0];
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className={styles.label}>{copy.sort}</legend>
      {sorts.map((sort, index) => (
        <div key={sort.field} className="grid grid-cols-2 gap-2">
          <RecordQuerySelect
            label={copy.field}
            editable={editable}
            value={sort.field}
            options={choices
              .filter((field) => field === sort.field || unused.includes(field))
              .map((value) => ({ value, label: copy.fields[value] }))}
            onChange={(value) => {
              const field = unused.find((candidate) => candidate === value);
              if (editable && field !== undefined)
                onChange(
                  sorts.map((item, cursor) => (cursor === index ? { ...item, field } : item)),
                );
            }}
          />
          <RecordQuerySelect
            label={copy.direction}
            editable={editable}
            value={sort.direction}
            options={[
              { value: "asc", label: copy.asc },
              { value: "desc", label: copy.desc },
            ]}
            onChange={(direction) => {
              if (editable && (direction === "asc" || direction === "desc"))
                onChange(
                  sorts.map((item, cursor) => (cursor === index ? { ...item, direction } : item)),
                );
            }}
          />
          {editable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(sorts.filter((_, cursor) => cursor !== index))}
            >
              {copy.remove}
            </Button>
          )}
        </div>
      ))}
      {editable && sorts.length < 3 && next !== undefined && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...sorts, { field: next, direction: "asc" }])}
        >
          {copy.addSort}
        </Button>
      )}
    </fieldset>
  );
}

function SearchOptions({
  context,
  change,
}: {
  context: FormContext;
  change: (settings: RecordSearchDraftConfig) => void;
}) {
  const copy = useRecordQueryCopy();
  const { draft, node, definition, metadata, editable, errorFor } = context;
  function setFilter(filter: RecordSearchFilterGroup | undefined) {
    const next = { ...draft };
    if (filter === undefined) delete next.filter;
    else next.filter = filter;
    change(next);
  }
  return (
    <>
      <hr />
      {draft.filter === undefined ? (
        editable && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setFilter(newGroup(draft.entity))}
          >
            {copy.addFilter}
          </Button>
        )
      ) : (
        <FilterFields
          context={context}
          group={draft.filter}
          depth={1}
          path={["filter"]}
          count={entryCount(draft.filter)}
          onChange={setFilter}
        />
      )}
      <SortFields context={context} onChange={(orderBy) => change({ ...draft, orderBy })} />
      {(["limit", "offset"] as const).map((kind) => (
        <BindingField
          key={kind}
          definition={definition}
          nodeId={node.id}
          editable={editable}
          kind="scalar"
          metadata={metadata}
          target={recordSearchBindingTarget(node.id, draft, [kind])}
          value={draft[kind] ?? { kind: "value", value: kind === "limit" ? 1 : 0 }}
          label={copy[kind]}
          sourceLabel={`${copy[kind]} · ${copy.source}`}
          error={errorFor([kind])}
          onChange={(binding) => change({ ...draft, [kind]: binding })}
        />
      ))}
    </>
  );
}

export function SearchRecordConfigurationFields({
  definition,
  node,
  editable,
  onChange,
  validation,
  metadata,
}: Props) {
  const t = useAppTranslations("workflows");
  const copy = useRecordQueryCopy();
  const parsed = recordSearchDraftConfig.safeParse(node.config);
  const draft = parsed.success ? parsed.data : {};
  const entity = draft.entity;
  function errorFor(path: readonly string[]) {
    const issue = validation.issues.find(
      (item) =>
        item.path.length === path.length && path.every((key, index) => item.path[index] === key),
    );
    return issue === undefined ? undefined : t(configurationIssueKeys[issue.code]);
  }
  function change(config: RecordSearchDraftConfig) {
    if (editable) onChange({ ...node, config: { ...config } });
  }
  return (
    <>
      <RecordQuerySelect
        label={copy.object}
        value={entity ?? ""}
        editable={editable}
        error={errorFor(["entity"])}
        options={recordLookupEntities.map((value) => ({ value, label: copy.entities[value] }))}
        onChange={(value) => {
          const selected = recordLookupEntitySchema.safeParse(value);
          if (selected.success && selected.data !== entity)
            change({
              entity: selected.data,
              ...(draft.limit === undefined ? {} : { limit: draft.limit }),
              ...(draft.offset === undefined ? {} : { offset: draft.offset }),
            });
        }}
      />
      {entity !== undefined && (
        <SearchOptions
          context={{ definition, node, editable, metadata, draft: { ...draft, entity }, errorFor }}
          change={change}
        />
      )}
    </>
  );
}
