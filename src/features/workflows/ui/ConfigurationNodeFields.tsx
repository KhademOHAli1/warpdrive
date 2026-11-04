"use client";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type {
  ConfigurationFieldSpec,
  ConfigurationMetadata,
  ConfigurationSpec,
  ConfigurationValidation,
} from "../configurationTypes";
import { bindingSchema, type WorkflowDefinition, type WorkflowNode } from "../schemas";
import { BindingField } from "./BindingField";
import { ConditionFields } from "./ConditionFields";
import { type ConfigurationIssueKey, configurationIssueKeys } from "./configurationIssueMessage";
import { DelayFields } from "./DelayFields";
import { WorkflowCustomBinding } from "./WorkflowCustomBinding";
import { WorkflowRecordChoice } from "./WorkflowRecordChoice";

export interface ConfigurationFieldsProps {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  workflowId?: string;
  spec: ConfigurationSpec | null;
  validation: ConfigurationValidation;
  metadata: ConfigurationMetadata;
}
export function configurationFieldError(
  validation: ConfigurationValidation,
  key: string,
  translate: (key: ConfigurationIssueKey) => string,
) {
  const issue = validation.issues.find((issue) => issue.path[0] === key);
  return issue === undefined ? undefined : translate(configurationIssueKeys[issue.code]);
}
function BuiltinField({
  field,
  ...props
}: ConfigurationFieldsProps & { field: ConfigurationFieldSpec }) {
  const t = useAppTranslations("workflows");
  const { definition, node, editable, onChange, workflowId, validation } = props;
  const pathKey = field.path[0];
  if (pathKey === undefined) return null;
  const key = pathKey;
  const deal = field.valueType === "deal";
  const label = t(field.label, {});
  const sourceLabels: Record<string, string> = {
    subject: "subjectSource",
    recordId: "recordSource",
  };
  const sourceLabel = sourceLabels[key] === undefined ? label : t(sourceLabels[key], {});
  const parsed = bindingSchema.safeParse(node.config[key]);
  const value = parsed.success && parsed.data.kind === "value" ? parsed.data.value : undefined;
  function update(fieldKey: string, value: WorkflowNode["config"][string] | undefined) {
    if (!editable) return;
    const config = { ...node.config };
    if (value === undefined) delete config[fieldKey];
    else config[fieldKey] = value;
    onChange({ ...node, config });
  }
  const literal =
    deal && workflowId !== undefined && (key === "recordId" || key === "dealId") ? (
      <WorkflowRecordChoice
        workflowId={workflowId}
        type={node.type}
        field={key}
        value={value}
        editable={editable}
        label={label}
        onChange={(id) => update(key, { kind: "value", value: id })}
      />
    ) : undefined;
  return (
    <BindingField
      definition={definition}
      nodeId={node.id}
      value={node.config[key]}
      onChange={(binding) => update(key, binding)}
      kind={deal ? "deal" : "text"}
      label={label}
      sourceLabel={sourceLabel}
      editable={editable}
      allowLiteral={!deal}
      allowNull={field.nullable}
      onOmit={field.modes.includes("omit") ? () => update(key, undefined) : undefined}
      maxLength={field.constraints?.maxLength}
      error={configurationFieldError(validation, key, t)}
      literalControl={literal}
    />
  );
}
function ConfigurationField({
  field,
  ...props
}: ConfigurationFieldsProps & { field: ConfigurationFieldSpec }) {
  const t = useAppTranslations("workflows");
  const { node, editable, onChange, validation, metadata } = props;
  const key = field.path[0];
  if (key === undefined || field.control === "name" || field.control === "entity") return null;
  if (field.readOnly === true)
    return Object.hasOwn(node.config, key) ? (
      <p className="text-xs text-destructive">{t("configurationUnsupportedSetting")}</p>
    ) : null;
  const def = field.customField;
  if (field.control === "custom" && def !== undefined) {
    const issue = validation.issues.find(
      (issue) => issue.path[0] === "customFields" && issue.path[1] === def.id,
    );
    return (
      <WorkflowCustomBinding
        definition={props.definition}
        node={node}
        def={def}
        workflowId={props.workflowId}
        fingerprint={metadata.fingerprint}
        editable={editable}
        onChange={onChange}
        error={issue === undefined ? undefined : t(configurationIssueKeys[issue.code])}
      />
    );
  }
  if (field.control === "duration")
    return (
      <DelayFields
        value={node.config[key]}
        editable={editable}
        onChange={(value) => {
          if (editable) onChange({ ...node, config: { ...node.config, [key]: value } });
        }}
        error={configurationFieldError(validation, key, t)}
      />
    );
  return <BuiltinField {...props} field={field} />;
}
export function ConfigurationNodeFields(props: ConfigurationFieldsProps) {
  const t = useAppTranslations("workflows");
  const { spec, definition, node, editable, onChange, validation } = props;
  if (spec === null) return null;
  if (spec.fields.some((field) => field.control === "operator"))
    return (
      <ConditionFields
        definition={definition}
        node={node}
        editable={editable}
        onChange={onChange}
        errors={{
          left: configurationFieldError(validation, "left", t),
          right: configurationFieldError(validation, "right", t),
          operator: configurationFieldError(validation, "operator", t),
        }}
      />
    );
  return (
    <>
      {spec.fields.map((field) => (
        <ConfigurationField key={field.path.join(".")} {...props} field={field} />
      ))}
    </>
  );
}
export function RetainedConfigurationIssues({
  spec,
  validation,
}: Pick<ConfigurationFieldsProps, "spec" | "validation">) {
  const t = useAppTranslations("workflows");
  const known = new Set(
    spec?.fields.flatMap((field) =>
      field.customField === undefined ? [] : [field.customField.id],
    ),
  );
  const retained = validation.issues.filter(
    (issue) =>
      issue.path[0] === "customFields" &&
      (issue.path[1] === undefined || !known.has(issue.path[1])) &&
      issue.code !== "metadata_incomplete" &&
      issue.code !== "metadata_stale",
  );
  const unique = [
    ...new Map(retained.map((issue) => [issue.code + ":" + issue.path.join("."), issue])).values(),
  ];
  return (
    <>
      {unique.map((issue) => (
        <p key={issue.code + ":" + issue.path.join(".")} className="text-xs text-destructive">
          {t(configurationIssueKeys[issue.code])}
        </p>
      ))}
    </>
  );
}
