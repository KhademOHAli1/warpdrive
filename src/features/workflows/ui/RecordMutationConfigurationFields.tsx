"use client";

import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { ACTIVITY_PRIORITY_KEYS } from "@/constants/activityPriorities";
import { useActivitiesMessages } from "@/features/activities/useActivitiesMessages";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { ConfigurationValidation } from "../configurationTypes";
import { typedLiteralFromInput } from "../mappingLiteralIntent";
import {
  type DraftBinding,
  draftBindingSchema,
  type WorkflowDefinition,
  type WorkflowNode,
} from "../schemas";
import {
  type RecordMutationEntity,
  type RecordUpdateField,
  recordMutationEntities,
  recordMutationEntitySchema,
  recordMutationTarget,
  recordUpdateFields,
} from "../workflowRecordMutationContract";
import { BindingField } from "./BindingField";
import { configurationIssueKeys } from "./configurationIssueMessage";
import { WorkflowMutationRecordChoice } from "./WorkflowMutationRecordChoice";
import { WorkflowReferenceIcon } from "./WorkflowReferenceIcon";
import styles from "./workflowInspector.module.css";

interface Props {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  validation: ConfigurationValidation;
  workflowId?: string;
}

type FieldValues = Record<string, WorkflowNode["config"][string]>;

function fieldsOf(node: WorkflowNode): FieldValues {
  const fields = node.config.fields;
  return fields !== null && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
}

function updateLabel(
  key: RecordUpdateField["key"],
  t: ReturnType<typeof useAppTranslations<"workflows">>,
): string {
  if (key === "domain") return t("recordMutationDomain");
  if (key === "industry") return t("recordMutationIndustry");
  if (key === "location") return t("recordMutationLocation");
  return t(`recordCreateFields.${key}`);
}

export function RecordMutationTargetField({
  node,
  definition,
  entity,
  editable,
  workflowId,
  error,
  onChange,
}: Pick<Props, "node" | "definition" | "editable" | "workflowId"> & {
  entity: RecordMutationEntity;
  error?: string;
  onChange: (binding: DraftBinding) => void;
}) {
  const t = useAppTranslations("workflows");
  const label = t("recordMutationRecord");
  const value = node.config.recordId;
  return (
    <BindingField
      definition={definition}
      nodeId={node.id}
      value={value}
      onChange={onChange}
      kind="scalar"
      label={label}
      sourceLabel={t("recordMutationRecordSource")}
      editable={editable}
      allowLiteral={false}
      target={recordMutationTarget(node.id, entity, ["recordId"])}
      error={error}
      literalControl={
        workflowId === undefined ? (
          <p className="text-xs text-muted-foreground">{t("configurationNoChoices")}</p>
        ) : (
          <WorkflowMutationRecordChoice
            workflowId={workflowId}
            type={node.type}
            entity={entity}
            value={value}
            editable={editable}
            label={label}
            onChange={(id) => onChange({ kind: "value", value: id })}
          />
        )
      }
    />
  );
}

function PriorityValue({
  value,
  label,
  editable,
  onChange,
}: {
  value: unknown;
  label: string;
  editable: boolean;
  onChange: (binding: DraftBinding) => void;
}) {
  const t = useAppTranslations("workflows");
  const activity = useActivitiesMessages();
  const parsed = draftBindingSchema.safeParse(value);
  const literal = parsed.success && parsed.data.kind === "value" ? parsed.data.value : undefined;
  return (
    <Select
      ariaLabel={label}
      value={literal === null ? "__clear__" : typeof literal === "string" ? literal : ""}
      options={[
        { value: "__clear__", label: t("configurationNullValue") },
        ...ACTIVITY_PRIORITY_KEYS.map((key) => ({ value: key, label: activity.priorities[key] })),
      ]}
      disabled={!editable}
      placeholder={t("chooseValue")}
      onChange={(key) => {
        if (editable) onChange({ kind: "value", value: key === "__clear__" ? null : key });
      }}
    />
  );
}

function UpdateField({
  node,
  definition,
  entity,
  field,
  value,
  editable,
  error,
  onChange,
  onRemove,
}: Pick<Props, "node" | "definition" | "editable"> & {
  entity: RecordMutationEntity;
  field: RecordUpdateField;
  value: unknown;
  error?: string;
  onChange: (binding: DraftBinding) => void;
  onRemove: () => void;
}) {
  const t = useAppTranslations("workflows");
  const label = updateLabel(field.key, t);
  return (
    <fieldset className="min-w-0 space-y-2 rounded-md border p-2">
      <legend className={styles.label}>{label}</legend>
      {field.key === "priority" ? (
        <>
          <PriorityValue label={label} value={value} editable={editable} onChange={onChange} />
          {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
        </>
      ) : (
        <BindingField
          definition={definition}
          nodeId={node.id}
          value={value}
          onChange={(binding) => {
            if (
              binding.kind === "value" &&
              typeof binding.value === "string" &&
              field.contract?.kind === "date"
            ) {
              onChange(typedLiteralFromInput("date", binding.value));
            } else onChange(binding);
          }}
          kind="text"
          label={label}
          sourceLabel={t("recordCreateFieldSource", { field: label })}
          editable={editable}
          target={recordMutationTarget(node.id, entity, ["fields", field.key])}
          allowNull={field.nullable}
          nullLabel={t("configurationNullValue")}
          maxLength={field.maxLength}
          error={error}
        />
      )}
      {editable && (
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <WorkflowReferenceIcon name="x" size={14} />
          {t("recordMutationRemoveField", { field: label })}
        </Button>
      )}
    </fieldset>
  );
}

function UpdateFields({
  node,
  definition,
  entity,
  editable,
  errorFor,
  onChange,
}: Pick<Props, "node" | "definition" | "editable" | "onChange"> & {
  entity: RecordMutationEntity;
  errorFor: (...path: string[]) => string | undefined;
}) {
  const t = useAppTranslations("workflows");
  const fields = fieldsOf(node);
  const offered = recordUpdateFields[entity];
  const remaining = offered.filter(({ key }) => !Object.hasOwn(fields, key));
  const invalid = errorFor("fields");
  function patchDraft(key: string, binding?: DraftBinding) {
    if (!editable) return;
    const next = { ...fields };
    if (binding === undefined) delete next[key];
    else next[key] = binding;
    onChange({ ...node, config: { ...node.config, fields: next } });
  }
  return (
    <>
      <hr />
      <fieldset className="min-w-0 space-y-2">
        <legend className={styles.label}>{t("recordMutationFields")}</legend>
        {remaining.length > 0 && editable && (
          <Select
            ariaLabel={t("recordMutationAddField")}
            value=""
            options={remaining.map(({ key }) => ({ value: key, label: updateLabel(key, t) }))}
            placeholder={t("recordMutationAddField")}
            onChange={(key) => {
              const field = remaining.find((option) => option.key === key);
              if (field === undefined) return;
              patchDraft(
                key,
                field.contract?.kind === "date"
                  ? typedLiteralFromInput("date", "")
                  : { kind: "value", value: "" },
              );
            }}
          />
        )}
        {invalid !== undefined && <p className="text-xs text-destructive">{invalid}</p>}
        {offered
          .filter(({ key }) => Object.hasOwn(fields, key))
          .map((field) => (
            <UpdateField
              key={field.key}
              node={node}
              definition={definition}
              entity={entity}
              field={field}
              value={fields[field.key]}
              editable={editable}
              error={errorFor("fields", field.key)}
              onChange={(binding) => patchDraft(field.key, binding)}
              onRemove={() => patchDraft(field.key)}
            />
          ))}
      </fieldset>
    </>
  );
}

export function RecordMutationConfigurationFields({
  definition,
  node,
  editable,
  onChange,
  validation,
  workflowId,
}: Props) {
  const t = useAppTranslations("workflows");
  const parsed = recordMutationEntitySchema.safeParse(node.config.entity);
  const entity = parsed.success ? parsed.data : undefined;
  const isUpdate = node.type === "record.update";
  const objectError = errorFor("entity");
  function errorFor(...path: string[]) {
    const issue = validation.issues.find(
      (item) =>
        item.path.length === path.length && item.path.every((part, index) => part === path[index]),
    );
    return issue === undefined ? undefined : t(configurationIssueKeys[issue.code]);
  }
  return (
    <>
      <fieldset className="min-w-0 space-y-2">
        <legend className={styles.label}>{t("recordCreateObject")}</legend>
        <Select
          ariaLabel={t("recordCreateObject")}
          value={entity ?? ""}
          disabled={!editable}
          options={recordMutationEntities.map((value) => ({
            value,
            label: t(`recordCreateObjects.${value}`),
          }))}
          placeholder={t("chooseValue")}
          onChange={(raw) => {
            const next = recordMutationEntitySchema.safeParse(raw);
            if (editable && next.success && next.data !== entity) {
              onChange({
                ...node,
                config: isUpdate ? { entity: next.data, fields: {} } : { entity: next.data },
              });
            }
          }}
        />
        {objectError !== undefined && <p className="text-xs text-destructive">{objectError}</p>}
      </fieldset>
      {entity !== undefined && (
        <>
          <hr />
          <RecordMutationTargetField
            key={`record.${entity}`}
            node={node}
            definition={definition}
            entity={entity}
            editable={editable}
            workflowId={workflowId}
            error={errorFor("recordId")}
            onChange={(binding) => {
              if (editable) onChange({ ...node, config: { ...node.config, recordId: binding } });
            }}
          />
          {isUpdate ? (
            <UpdateFields
              key={`fields.${entity}`}
              node={node}
              definition={definition}
              entity={entity}
              editable={editable}
              errorFor={errorFor}
              onChange={onChange}
            />
          ) : (
            <p className="text-xs text-muted-foreground">{t("recordMutationSoftDeleteHint")}</p>
          )}
        </>
      )}
    </>
  );
}
