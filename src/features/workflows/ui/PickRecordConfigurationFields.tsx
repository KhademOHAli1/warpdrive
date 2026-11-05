"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { ConfigurationValidation } from "../configurationTypes";
import type { WorkflowNode } from "../schemas";
import { recordPickCandidateMax } from "../workflowRecordQueryBounds";
import {
  type RecordLookupEntity,
  type RecordPickDraftConfig,
  recordLookupEntities,
  recordLookupEntitySchema,
  recordPickDraftConfig,
  recordPickRelations,
  recordPickStrategies,
} from "../workflowRecordQueryContract";
import { configurationIssueKeys } from "./configurationIssueMessage";
import { RecordQuerySelect } from "./RecordQuerySelect";
import { useRecordQueryCopy } from "./recordQueryCopy";
import styles from "./workflowInspector.module.css";

interface Candidate {
  id: string;
  label: string;
}

export interface RecordPickCandidateRead {
  search: string;
  onSearch: (query: string) => void;
  status: "idle" | "loading" | "ready" | "error" | "denied";
  options: readonly Candidate[];
  selected?: readonly Candidate[];
  nextCursor?: string | null;
  onMore?: () => void | Promise<void>;
}

interface Props {
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  validation: ConfigurationValidation;
  read?: RecordPickCandidateRead;
}

function BalanceFields({
  entity,
  value,
  editable,
  error,
  onChange,
}: {
  entity: RecordLookupEntity;
  value: RecordPickDraftConfig["loadBalance"];
  editable: boolean;
  error?: string;
  onChange: (balance: NonNullable<RecordPickDraftConfig["loadBalance"]>) => void;
}) {
  const copy = useRecordQueryCopy();
  const relations = recordPickRelations(entity);
  const entities = [...new Set(relations.map((item) => item.entity))];
  if (entities.length === 0)
    return <p className="text-xs text-muted-foreground">{copy.noRelation}</p>;
  return (
    <>
      <RecordQuerySelect
        label={copy.balanceBy}
        value={value?.entity ?? ""}
        editable={editable}
        options={entities.map((candidate) => ({
          value: candidate,
          label: copy.entities[candidate],
        }))}
        error={error}
        onChange={(entity) => {
          const selected = relations.find((item) => item.entity === entity);
          if (editable && selected !== undefined && selected.entity !== value?.entity)
            onChange({ entity: selected.entity, field: selected.field });
        }}
      />
      {value !== undefined && (
        <RecordQuerySelect
          label={copy.countBy}
          value={value.field}
          editable={editable}
          options={relations
            .filter((item) => item.entity === value.entity)
            .map((item) => ({ value: item.field, label: copy.fields[item.field] }))}
          onChange={(field) => {
            const selected = relations.find(
              (item) => item.entity === value.entity && item.field === field,
            );
            if (editable && selected !== undefined && selected.field !== value.field)
              onChange({ entity: selected.entity, field: selected.field });
          }}
        />
      )}
    </>
  );
}

function CandidatePool({
  ids,
  editable,
  read,
  error,
  onChange,
}: {
  ids: readonly string[];
  editable: boolean;
  read: RecordPickCandidateRead | undefined;
  error?: string;
  onChange: (ids: string[]) => void;
}) {
  const copy = useRecordQueryCopy();
  const t = useAppTranslations("workflows");
  const format = useFormatters();
  const status = read?.status ?? "idle";
  const selectedIds = new Set(ids.map((id) => id.toLowerCase()));
  const options =
    status === "ready"
      ? (read?.options.filter((option) => !selectedIds.has(option.id.toLowerCase())) ?? [])
      : [];
  const known = status === "ready" ? [...(read?.selected ?? []), ...(read?.options ?? [])] : [];
  const labels = new Map(known.map((item) => [item.id.toLowerCase(), item.label]));
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className={styles.label}>{copy.pickFrom}</legend>
      {ids.length > 0 && (
        <ul aria-label={copy.selected} className="flex flex-wrap gap-1.5">
          {ids.map((id, index) => {
            const label =
              labels.get(id.toLowerCase()) ??
              `${t("unavailableValue")} ${format.number(index + 1)}`;
            return (
              <li
                key={id}
                className="flex min-w-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
              >
                <bdi dir="auto" className="truncate">
                  {label}
                </bdi>
                {editable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`${copy.remove} · ${label}`}
                    onClick={() => onChange(ids.filter((candidate) => candidate !== id))}
                  >
                    {copy.remove}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editable && read !== undefined && status !== "denied" && (
        <>
          <Input
            aria-label={copy.search}
            value={read.search}
            maxLength={200}
            disabled={ids.length >= recordPickCandidateMax}
            onChange={(event) => read.onSearch(event.currentTarget.value)}
          />
          <RecordQuerySelect
            label={copy.addCandidate}
            value=""
            editable={
              status === "ready" && options.length > 0 && ids.length < recordPickCandidateMax
            }
            options={options.map((item) => ({ value: item.id, label: item.label }))}
            onChange={(id) => {
              if (ids.length < recordPickCandidateMax && options.some((item) => item.id === id))
                onChange([...ids, id]);
            }}
          />
          {status === "ready" && read.nextCursor != null && read.onMore !== undefined && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void read.onMore?.();
              }}
            >
              {t("customReferenceMore")}
            </Button>
          )}
        </>
      )}
      {status === "loading" && (
        <p role="status" className="text-xs text-muted-foreground">
          {copy.loading}
        </p>
      )}
      {status === "ready" && read?.options.length === 0 && (
        <p className="text-xs text-muted-foreground">{copy.noResults}</p>
      )}
      {status === "error" && (
        <p role="alert" className="text-xs text-destructive">
          {copy.lookupError}
        </p>
      )}
      {(status === "denied" || (read === undefined && editable)) && (
        <p className="text-xs text-muted-foreground">{copy.denied}</p>
      )}
      {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
    </fieldset>
  );
}

export function PickRecordConfigurationFields({
  node,
  editable,
  onChange,
  validation,
  read,
}: Props) {
  const t = useAppTranslations("workflows");
  const copy = useRecordQueryCopy();
  const parsed = recordPickDraftConfig.safeParse(node.config);
  const draft = parsed.success ? parsed.data : {};
  const entity = draft.entity;
  const strategy = draft.strategy ?? "RANDOM";
  const strategies = recordPickStrategies.filter(
    (item) =>
      item !== "LOAD_BALANCED" ||
      strategy === item ||
      (entity !== undefined && recordPickRelations(entity).length > 0),
  );
  function errorFor(key: string) {
    const issue = validation.issues.find((item) => item.path[0] === key);
    return issue === undefined ? undefined : t(configurationIssueKeys[issue.code]);
  }
  function change(config: RecordPickDraftConfig) {
    if (editable) onChange({ ...node, config: { ...config } });
  }
  return (
    <>
      <RecordQuerySelect
        label={copy.object}
        value={entity ?? ""}
        editable={editable}
        options={recordLookupEntities.map((value) => ({ value, label: copy.entities[value] }))}
        error={errorFor("entity")}
        onChange={(value) => {
          const parsed = recordLookupEntitySchema.safeParse(value);
          if (parsed.success && parsed.data !== entity)
            change({ entity: parsed.data, strategy, recordIds: [] });
        }}
      />
      {entity !== undefined && (
        <>
          <RecordQuerySelect
            label={copy.strategy}
            value={strategy}
            editable={editable}
            options={strategies.map((value) => ({ value, label: copy.strategies[value] }))}
            error={errorFor("strategy")}
            onChange={(value) => {
              const selected = strategies.find((item) => item === value);
              if (selected !== undefined && selected !== strategy)
                change({ entity, strategy: selected, recordIds: draft.recordIds ?? [] });
            }}
          />
          {strategy === "LOAD_BALANCED" && (
            <BalanceFields
              entity={entity}
              value={draft.loadBalance}
              editable={editable}
              error={errorFor("loadBalance")}
              onChange={(loadBalance) => change({ ...draft, entity, strategy, loadBalance })}
            />
          )}
          <hr />
          <CandidatePool
            ids={draft.recordIds ?? []}
            editable={editable}
            read={read}
            error={errorFor("recordIds")}
            onChange={(recordIds) => change({ ...draft, entity, strategy, recordIds })}
          />
        </>
      )}
    </>
  );
}
