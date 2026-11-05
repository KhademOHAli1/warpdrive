"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Select, type SelectOption } from "@/components/ui/Select";
import { ACTIVITY_PRIORITY_KEYS } from "@/constants/activityPriorities";
import { useActivitiesMessages } from "@/features/activities/useActivitiesMessages";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import type { ConfigurationValidation } from "../configurationTypes";
import { typedLiteralFromInput } from "../mappingLiteralIntent";
import {
  type DraftBinding,
  draftBindingSchema,
  type WorkflowDefinition,
  type WorkflowNode,
} from "../schemas";
import {
  type RecordCreateEntity,
  type RecordCreateField,
  recordCreateEntities,
  recordCreateEntitySchema,
  recordCreateFields,
  recordCreateFieldTarget,
} from "../workflowRecordCreateContract";
import { BindingField } from "./BindingField";
import { configurationIssueKeys } from "./configurationIssueMessage";
import styles from "./workflowInspector.module.css";

interface Props {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  validation: ConfigurationValidation;
}

type FieldValues = Record<string, WorkflowNode["config"][string]>;

function fieldValues(node: WorkflowNode): FieldValues {
  const fields = node.config.fields;
  return fields !== null && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
}

function literalText(value: unknown): string {
  const parsed = draftBindingSchema.safeParse(value);
  if (!parsed.success || parsed.data.kind !== "value") return "";
  return typeof parsed.data.value === "string" ? parsed.data.value : "";
}

function LiteralSelect({
  label,
  value,
  options,
  disabled,
  error,
  unavailable,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  disabled: boolean;
  error?: string;
  unavailable?: boolean;
  onChange: (value: string) => void;
}) {
  const t = useAppTranslations("workflows");
  const errorId = useId();
  return (
    <fieldset
      className="min-w-0 space-y-1"
      aria-describedby={error === undefined ? undefined : errorId}
    >
      <legend className={styles.label}>{label}</legend>
      <Select
        ariaLabel={label}
        value={value}
        options={options}
        disabled={disabled}
        placeholder={t(unavailable ? "unavailableValue" : "chooseValue")}
        onChange={onChange}
      />
      {error !== undefined && (
        <p className="text-xs text-destructive" id={errorId}>
          {error}
        </p>
      )}
    </fieldset>
  );
}

function DealDestination({
  fields,
  editable,
  errorFor,
  setFields,
}: {
  fields: FieldValues;
  editable: boolean;
  errorFor: (key: string) => string | undefined;
  setFields: (patch: Partial<Record<string, DraftBinding | undefined>>) => void;
}) {
  const t = useAppTranslations("workflows");
  const read = trpc.pipeline.list.useQuery();
  const pipelineId = literalText(fields.pipelineId);
  const stageId = literalText(fields.stageId);
  const pipelines = read.isSuccess ? read.data : [];
  const stages = pipelines.find((pipeline) => pipeline.id === pipelineId)?.stages ?? [];
  const unavailablePipeline =
    read.isSuccess &&
    pipelineId !== "" &&
    !pipelines.some((pipeline) => pipeline.id === pipelineId);
  const unavailableStage =
    read.isSuccess && stageId !== "" && !stages.some((stage) => stage.id === stageId);
  return (
    <>
      <LiteralSelect
        label={t("recordCreateFields.pipelineId")}
        value={pipelineId}
        options={pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))}
        disabled={!editable || pipelines.length === 0}
        error={unavailablePipeline ? t("configurationOptionUnavailable") : errorFor("pipelineId")}
        unavailable={unavailablePipeline}
        onChange={(value) => {
          if (value !== pipelineId && pipelines.some((pipeline) => pipeline.id === value)) {
            setFields({ pipelineId: { kind: "value", value }, stageId: undefined });
          }
        }}
      />
      <LiteralSelect
        label={t("recordCreateFields.stageId")}
        value={stageId}
        options={stages.map((stage) => ({ value: stage.id, label: stage.name }))}
        disabled={!editable || stages.length === 0}
        error={unavailableStage ? t("configurationOptionUnavailable") : errorFor("stageId")}
        unavailable={unavailableStage}
        onChange={(value) => {
          if (stages.some((stage) => stage.id === value))
            setFields({ stageId: { kind: "value", value } });
        }}
      />
      {read.isError && (
        <div className="space-y-2 text-xs text-destructive" role="alert">
          <p>{t("configurationLookupError")}</p>
          <Button variant="outline" onClick={() => void read.refetch()}>
            {t("retry")}
          </Button>
        </div>
      )}
      {read.isSuccess && pipelines.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("configurationNoChoices")}</p>
      )}
    </>
  );
}

function PriorityField({
  value,
  editable,
  onChange,
  error,
}: {
  value: unknown;
  editable: boolean;
  onChange: (value: DraftBinding | undefined) => void;
  error?: string;
}) {
  const t = useAppTranslations("workflows");
  const activity = useActivitiesMessages();
  return (
    <LiteralSelect
      label={t("recordCreateFields.priority")}
      value={literalText(value)}
      disabled={!editable}
      options={[
        { value: "", label: activity.noPriority },
        ...ACTIVITY_PRIORITY_KEYS.map((key) => ({ value: key, label: activity.priorities[key] })),
      ]}
      error={error}
      onChange={(value) => onChange(value === "" ? undefined : { kind: "value", value })}
    />
  );
}

function RecordField({
  field,
  entity,
  node,
  definition,
  editable,
  value,
  error,
  onChange,
}: Pick<Props, "node" | "definition" | "editable"> & {
  field: RecordCreateField;
  entity: RecordCreateEntity;
  value: unknown;
  error?: string;
  onChange: (value: DraftBinding | undefined) => void;
}) {
  const t = useAppTranslations("workflows");
  if (field.key === "priority")
    return <PriorityField value={value} editable={editable} onChange={onChange} error={error} />;
  const target = recordCreateFieldTarget(node.id, entity, field.key);
  const label = t(`recordCreateFields.${field.key}`);
  return (
    <BindingField
      definition={definition}
      nodeId={node.id}
      kind="text"
      label={label}
      sourceLabel={t("recordCreateFieldSource", { field: label })}
      value={value}
      editable={editable}
      maxLength={field.maxLength}
      target={target}
      error={error}
      onOmit={field.required === true ? undefined : () => onChange(undefined)}
      onChange={(binding) => {
        const kind = field.contract?.kind;
        onChange(
          binding.kind === "value" &&
            typeof binding.value === "string" &&
            (kind === "date" || kind === "instant")
            ? typedLiteralFromInput(kind, binding.value)
            : binding,
        );
      }}
    />
  );
}

export function CreateRecordConfigurationFields({
  definition,
  node,
  editable,
  onChange,
  validation,
}: Props) {
  const t = useAppTranslations("workflows");
  const selected = recordCreateEntitySchema.safeParse(node.config.entity);
  const entity = selected.success ? selected.data : undefined;
  const fields = fieldValues(node);

  function errorFor(...path: string[]) {
    const issue = validation.issues.find(
      (item) =>
        item.path.length === path.length && item.path.every((part, index) => part === path[index]),
    );
    return issue === undefined ? undefined : t(configurationIssueKeys[issue.code]);
  }

  function setFields(patch: Partial<Record<string, DraftBinding | undefined>>) {
    if (!editable) return;
    const next = { ...fields };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    onChange({ ...node, config: { ...node.config, fields: next } });
  }

  return (
    <>
      <LiteralSelect
        label={t("recordCreateObject")}
        value={entity ?? ""}
        disabled={!editable}
        options={recordCreateEntities.map((value) => ({
          value,
          label: t(`recordCreateObjects.${value}`),
        }))}
        error={errorFor("entity")}
        onChange={(value) => {
          const choice = recordCreateEntitySchema.safeParse(value);
          if (editable && choice.success && choice.data !== entity) {
            onChange({ ...node, config: { entity: choice.data, fields: {} } });
          }
        }}
      />
      {entity !== undefined && (
        <>
          <hr />
          {entity === "deal" && (
            <DealDestination
              fields={fields}
              editable={editable}
              errorFor={(key) => errorFor("fields", key)}
              setFields={setFields}
            />
          )}
          {recordCreateFields[entity]
            .filter(({ key }) => key !== "pipelineId" && key !== "stageId")
            .map((field) => (
              <RecordField
                key={`${entity}.${field.key}`}
                field={field}
                entity={entity}
                node={node}
                definition={definition}
                editable={editable}
                value={fields[field.key]}
                error={errorFor("fields", field.key)}
                onChange={(value) => setFields({ [field.key]: value })}
              />
            ))}
        </>
      )}
    </>
  );
}
