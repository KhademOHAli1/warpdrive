"use client";

import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import type { ConfigurationValidation } from "../configurationTypes";
import type { DraftBinding, WorkflowDefinition, WorkflowNode } from "../schemas";
import {
  type WorkflowPersonUpsertField,
  workflowPersonUpsertFields,
  workflowPersonUpsertKeyLimit,
  workflowPersonUpsertTarget,
} from "../workflowPersonUpsertContract";
import { BindingField } from "./BindingField";
import { configurationIssueKeys } from "./configurationIssueMessage";
import { WorkflowMutationRecordChoice } from "./WorkflowMutationRecordChoice";
import styles from "./workflowInspector.module.css";

const copy = {
  en: {
    key: "Stable key",
    hint: "The same key in this workflow updates the same person. A new key creates a person.",
  },
  de: {
    key: "Eindeutiger Schlüssel",
    hint: "Derselbe Schlüssel in diesem Workflow aktualisiert dieselbe Person. Ein neuer Schlüssel legt eine Person an.",
  },
  fa: {
    key: "کلید ثابت",
    hint: "استفاده از همان کلید در این گردش کار، همان شخص را به‌روزرسانی می‌کند. یک کلید جدید شخصی ایجاد می‌کند.",
  },
};

interface Props {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  validation: ConfigurationValidation;
  workflowId?: string;
}

function upsertFields(node: WorkflowNode) {
  const fields = node.config.fields;
  return fields !== null && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
}

export function PersonUpsertConfigurationFields({
  definition,
  node,
  editable,
  onChange,
  validation,
  workflowId,
}: Props) {
  const t = useAppTranslations("workflows");
  const text = copy[useLocale()];
  const fields = upsertFields(node);

  function change(patch: WorkflowNode["config"]) {
    if (editable) onChange({ ...node, config: { ...node.config, entity: "person", ...patch } });
  }
  function setField(field: WorkflowPersonUpsertField, value?: DraftBinding) {
    const next = { ...fields };
    if (value === undefined) delete next[field];
    else next[field] = value;
    change({ fields: next });
  }
  function issueFor(path: readonly string[]) {
    const issue = validation.issues.find(
      (entry) =>
        entry.path.length === path.length &&
        path.every((part, index) => entry.path[index] === part),
    );
    return issue === undefined ? undefined : t(configurationIssueKeys[issue.code]);
  }
  return (
    <div className="space-y-4">
      <div className={styles.field}>
        <p className={styles.label}>{t("recordCreateObject")}</p>
        <p>{t("recordCreateObjects.person")}</p>
      </div>
      <BindingField
        definition={definition}
        nodeId={node.id}
        kind="text"
        label={text.key}
        sourceLabel={t("recordCreateFieldSource", { field: text.key })}
        value={node.config.key}
        editable={editable}
        target={workflowPersonUpsertTarget(node.id, ["key"])}
        maxLength={workflowPersonUpsertKeyLimit}
        error={issueFor(["key"])}
        onChange={(binding) => change({ key: { ...binding } })}
      />
      <p className={styles.hint}>{text.hint}</p>
      {workflowPersonUpsertFields.map((field) => {
        const label = t(`recordCreateFields.${field}`);
        const organization = field === "orgId";
        const path = ["fields", field];
        return (
          <BindingField
            key={field}
            definition={definition}
            nodeId={node.id}
            kind={organization ? "scalar" : "text"}
            label={label}
            sourceLabel={t("recordCreateFieldSource", { field: label })}
            value={fields[field]}
            editable={editable}
            target={workflowPersonUpsertTarget(node.id, path)}
            maxLength={255}
            allowLiteral={!organization}
            allowNull={organization}
            nullLabel={t("configurationNullValue")}
            error={issueFor(path)}
            onChange={(binding) => setField(field, binding)}
            onOmit={field === "name" ? undefined : () => setField(field)}
            literalControl={
              organization ? (
                workflowId === undefined ? (
                  <p className={styles.hint}>{t("configurationNoChoices")}</p>
                ) : (
                  <WorkflowMutationRecordChoice
                    workflowId={workflowId}
                    type={node.type}
                    entity="organization"
                    value={fields.orgId}
                    editable={editable}
                    label={label}
                    onChange={(id) => setField(field, { kind: "value", value: id })}
                  />
                )
              ) : undefined
            }
          />
        );
      })}
    </div>
  );
}
