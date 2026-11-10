"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useComposerMailboxes } from "@/features/email/composer/useComposerMailboxes";
import { useComposerMailboxMessages } from "@/features/email/composer/useComposerMailboxMessages";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { MASK_CLASS } from "@/features/observability/replayMasking";
import type { ConfigurationValidation } from "../configurationTypes";
import {
  type DraftBinding,
  draftBindingSchema,
  type WorkflowDefinition,
  type WorkflowNode,
} from "../schemas";
import {
  type WorkflowEmailDraftField,
  workflowEmailDraftFields,
  workflowEmailDraftFieldTarget,
} from "../workflowEmailDraftContract";
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

function MailboxField({ node, editable, onChange, validation }: Omit<Props, "definition">) {
  const t = useAppTranslations("workflows");
  const copy = useComposerMailboxMessages();
  const read = useComposerMailboxes();
  const accountId = typeof node.config.accountId === "string" ? node.config.accountId : "";
  const mailboxes = read.known && !read.loading && !read.error ? read.mailboxes : [];
  const options = mailboxes.map(({ id, emailAddress }) => ({ value: id, label: emailAddress }));
  const unavailable =
    read.known &&
    !read.loading &&
    !read.error &&
    accountId !== "" &&
    !options.some((option) => option.value === accountId);
  const issue = validation.issues.find(({ path }) => path.length === 1 && path[0] === "accountId");
  const issueKey = unavailable
    ? "configurationOptionUnavailable"
    : issue && configurationIssueKeys[issue.code];
  const label = t("emailDraftFields.accountId");
  return (
    <fieldset className={styles.field}>
      <legend className={styles.label}>{label}</legend>
      <Select
        ariaLabel={label}
        value={accountId}
        options={options}
        placeholder={t(unavailable ? "unavailableValue" : "chooseValue")}
        contentClassName={MASK_CLASS}
        disabled={!editable || options.length === 0}
        onChange={(value) => {
          if (editable && value !== accountId && options.some((option) => option.value === value))
            onChange({ ...node, config: { ...node.config, accountId: value } });
        }}
      />
      {read.loading && (
        <p className={styles.hint} role="status">
          {copy.loadingMailboxes}
        </p>
      )}
      {read.error && (
        <div className="space-y-2 text-xs text-destructive" role="alert">
          <p>{copy.mailboxesError}</p>
          <Button variant="outline" size="sm" onClick={read.retry}>
            {t("retry")}
          </Button>
        </div>
      )}
      {read.known && !read.loading && !read.error && options.length === 0 && (
        <p className={styles.hint}>{t("emailDraftNoMailboxes")}</p>
      )}
      {issueKey !== undefined && <p className="text-xs text-destructive">{t(issueKey)}</p>}
    </fieldset>
  );
}

function ComposeField({
  field,
  definition,
  node,
  editable,
  onChange,
  validation,
}: Props & { field: WorkflowEmailDraftField }) {
  const t = useAppTranslations("workflows");
  const inputId = useId();
  const { key, maxLength } = field;
  const label = t(`emailDraftFields.${key}`);
  const value = node.config[key];
  const parsed = draftBindingSchema.safeParse(value);
  const literal =
    parsed.success && parsed.data.kind === "value" && typeof parsed.data.value === "string"
      ? parsed.data.value
      : "";
  const issue = validation.issues.find(({ path }) => path.length === 1 && path[0] === key);
  const error = issue === undefined ? undefined : t(configurationIssueKeys[issue.code]);
  const onBindingChange = (binding: DraftBinding) => {
    if (editable) onChange({ ...node, config: { ...node.config, [key]: binding } });
  };
  return (
    <BindingField
      definition={definition}
      nodeId={node.id}
      path={[key]}
      target={workflowEmailDraftFieldTarget(node.id, key)}
      kind="text"
      value={value}
      label={label}
      sourceLabel={t("recordCreateFieldSource", { field: label })}
      editable={editable}
      onChange={onBindingChange}
      maxLength={maxLength}
      allowLiteral={key !== "body"}
      literalControlLabel={t("literalValue")}
      literalControl={
        key === "body"
          ? (errorId) => (
              <div className={styles.field}>
                <label htmlFor={inputId}>{label}</label>
                <Textarea
                  id={inputId}
                  dir="auto"
                  value={literal}
                  disabled={!editable}
                  maxLength={maxLength}
                  aria-invalid={error !== undefined}
                  aria-describedby={error === undefined ? undefined : errorId}
                  onChange={(event) =>
                    onBindingChange({ kind: "value", value: event.currentTarget.value })
                  }
                />
              </div>
            )
          : undefined
      }
      error={error}
    />
  );
}

export function EmailDraftConfigurationFields(props: Props) {
  const t = useAppTranslations("workflows");
  const [to, cc, bcc, subject, body] = workflowEmailDraftFields;
  const { node } = props;
  return (
    <div className={`space-y-4 ${MASK_CLASS}`}>
      <p className={styles.hint}>{t("emailDraftLocalHint")}</p>
      <MailboxField {...props} />
      <ComposeField {...props} field={to} />
      <p className={styles.hint}>{t("emailDraftRecipientsHint")}</p>
      {(props.editable || node.config.cc !== undefined || node.config.bcc !== undefined) && (
        <details key={node.id} open={node.config.cc !== undefined || node.config.bcc !== undefined}>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {t("emailDraftAdvanced")}
          </summary>
          <div className="mt-3 space-y-4">
            <ComposeField {...props} field={cc} />
            <ComposeField {...props} field={bcc} />
          </div>
        </details>
      )}
      <ComposeField {...props} field={subject} />
      <ComposeField {...props} field={body} />
    </div>
  );
}
