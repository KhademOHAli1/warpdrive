"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { ToggleField } from "@/components/ui/ToggleField";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { MASK_CLASS } from "@/features/observability/replayMasking";
import { useFormatters } from "@/lib/useFormatters";
import type { ConfigurationMetadata, ConfigurationValidation } from "../configurationTypes";
import {
  type DraftBinding,
  draftBindingSchema,
  type WorkflowDefinition,
  type WorkflowNode,
} from "../schemas";
import {
  isWorkflowHttpHeaderName,
  workflowHttpMethods,
  workflowHttpRequestLimits,
  workflowHttpRequestTarget,
} from "../workflowHttpRequestContract";
import { BindingField } from "./BindingField";
import { configurationIssueKeys } from "./configurationIssueMessage";
import { WorkflowReferenceIcon } from "./WorkflowReferenceIcon";
import styles from "./workflowInspector.module.css";

const copy = {
  en: {
    policy:
      "Use an operator-approved HTTPS URL, including its exact path and query. Your operator manages credentials and allowed methods and headers.",
    live: "HTTP requests are sent only in live runs.",
    method: "HTTP method",
    headers: "Headers",
    headerName: "Header name",
    headerValue: "Header value",
    addHeader: "Add header",
    headerDenied:
      "Use an approved application header. Credentials and routing headers are managed by the operator.",
    body: "Request body",
    bodyMode: "Body format",
    none: "No body",
    text: "Text",
    json: "JSON object",
    bodyHint: "Switching to GET clears the request body.",
    fieldName: "Field name",
    fieldValue: "Field value",
    addField: "Add JSON field",
    response: "Expected response body",
    responseHint:
      "Only declared top-level JSON fields are available to later steps. The HTTP status is also available.",
    responseName: "Response field",
    responseType: "Response type",
    addResponse: "Add response field",
    nullable: "Allow null",
    remove: "Remove",
  },
  de: {
    policy:
      "Verwenden Sie eine freigegebene HTTPS-URL mit exaktem Pfad und Abfrage. Der Betreiber verwaltet Zugangsdaten, Methoden und Header.",
    live: "HTTP-Anfragen werden nur in Live-Ausführungen gesendet.",
    method: "HTTP-Methode",
    headers: "Header",
    headerName: "Headername",
    headerValue: "Headerwert",
    addHeader: "Header hinzufügen",
    headerDenied:
      "Verwenden Sie einen freigegebenen Anwendungsheader. Zugangsdaten und Routing-Header verwaltet der Betreiber.",
    body: "Anfrageinhalt",
    bodyMode: "Inhaltsformat",
    none: "Kein Inhalt",
    text: "Text",
    json: "JSON-Objekt",
    bodyHint: "Beim Wechsel zu GET wird der Anfrageinhalt entfernt.",
    fieldName: "Feldname",
    fieldValue: "Feldwert",
    addField: "JSON-Feld hinzufügen",
    response: "Erwarteter Antwortinhalt",
    responseHint:
      "Spätere Schritte können die angegebenen JSON-Felder der obersten Ebene und den HTTP-Status verwenden.",
    responseName: "Antwortfeld",
    responseType: "Antworttyp",
    addResponse: "Antwortfeld hinzufügen",
    nullable: "Null zulassen",
    remove: "Entfernen",
  },
  fa: {
    policy:
      "از نشانی HTTPS تأییدشده، با مسیر و پرس‌وجوی دقیق، استفاده کنید. مسئول سامانه اعتبارنامه‌ها، روش‌ها و سرآیندهای مجاز را مدیریت می‌کند.",
    live: "درخواست‌های HTTP فقط در اجرای واقعی فرستاده می‌شوند.",
    method: "روش HTTP",
    headers: "سرآیندها",
    headerName: "نام سرآیند",
    headerValue: "مقدار سرآیند",
    addHeader: "افزودن سرآیند",
    headerDenied:
      "از سرآیند برنامهٔ تأییدشده استفاده کنید. مسئول سامانه اعتبارنامه‌ها و سرآیندهای مسیریابی را مدیریت می‌کند.",
    body: "بدنهٔ درخواست",
    bodyMode: "قالب بدنه",
    none: "بدون بدنه",
    text: "متن",
    json: "شیء JSON",
    bodyHint: "تغییر روش به GET، بدنهٔ درخواست را پاک می‌کند.",
    fieldName: "نام فیلد",
    fieldValue: "مقدار فیلد",
    addField: "افزودن فیلد JSON",
    response: "بدنهٔ مورد انتظار پاسخ",
    responseHint:
      "مرحله‌های بعدی فقط به فیلدهای تعیین‌شده در سطح اول JSON و وضعیت HTTP دسترسی دارند.",
    responseName: "فیلد پاسخ",
    responseType: "نوع پاسخ",
    addResponse: "افزودن فیلد پاسخ",
    nullable: "پذیرش مقدار تهی",
    remove: "حذف",
  },
};

interface Props {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  validation: ConfigurationValidation;
  metadata?: ConfigurationMetadata;
}

type Config = WorkflowNode["config"];
type EntryProps = Pick<Props, "definition" | "node" | "editable" | "validation" | "metadata">;
type SectionProps = EntryProps & { onConfigChange: (config: Config) => void };

function object(value: Config[string] | undefined): Config {
  return value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function entries(value: Config[string] | undefined): Config[] {
  return Array.isArray(value) ? value.map((entry: Config[string]) => object(entry)) : [];
}

function textValue(value: Config[string] | undefined): string {
  return typeof value === "string" ? value : "";
}

const emptyBinding = { kind: "value", value: "" } as const;
const responseTypes = ["text", "number", "boolean"] as const;
const rowClass = "space-y-2 rounded-lg border border-[var(--workflow-border-medium)] p-2";

function fieldError(
  validation: ConfigurationValidation,
  path: readonly string[],
  t: ReturnType<typeof useAppTranslations<"workflows">>,
) {
  const issue = validation.issues.find(
    (item) =>
      item.path.length === path.length && path.every((part, index) => item.path[index] === part),
  );
  return issue === undefined ? undefined : t(configurationIssueKeys[issue.code]);
}

function RowName({
  label,
  value,
  invalid,
  editable,
  onChange,
  onRemove,
  removeLabel,
}: {
  label: string;
  value: string;
  invalid?: boolean;
  editable: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
  removeLabel: string;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className="flex min-w-0 items-center gap-1">
        <Input
          id={id}
          className="min-w-0 flex-1"
          value={value}
          dir="ltr"
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid}
          disabled={!editable}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        {editable && (
          <Button size="sm" variant="ghost" aria-label={removeLabel} onClick={onRemove}>
            <WorkflowReferenceIcon name="trash" size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}

function KeyValueEntries({
  rows,
  header,
  onChange,
  ...props
}: EntryProps & {
  rows: Config[];
  header: boolean;
  onChange: (rows: Config[]) => void;
}) {
  const t = useAppTranslations("workflows");
  const copyFor = copy[useLocale()];
  const format = useFormatters();
  const nameLabel = header ? copyFor.headerName : copyFor.fieldName;
  const valueLabel = header ? copyFor.headerValue : copyFor.fieldValue;
  const limit = header ? workflowHttpRequestLimits.headers : workflowHttpRequestLimits.fields;
  function edit(index: number, patch: Config) {
    if (props.editable)
      onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  }
  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const position = format.number(index + 1);
        const name = textValue(row.name);
        const denied = header && name !== "" && !isWorkflowHttpHeaderName(name);
        const valuePath = header
          ? ["headers", String(index), "value"]
          : ["body", "fields", String(index), "value"];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: Serialized binding paths address positional rows.
          <div key={index} className={rowClass}>
            <RowName
              label={`${nameLabel} ${position}`}
              value={name}
              invalid={denied}
              editable={props.editable}
              onChange={(value) => edit(index, { name: value })}
              removeLabel={`${copyFor.remove} ${nameLabel} ${position}`}
              onRemove={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
            />
            {denied && (
              <p role="alert" className="text-xs text-destructive">
                {copyFor.headerDenied}
              </p>
            )}
            {(!header || (name !== "" && !denied)) && (
              <BindingField
                definition={props.definition}
                nodeId={props.node.id}
                kind={header ? "text" : "scalar"}
                label={`${valueLabel} ${position}`}
                sourceLabel={t("recordCreateFieldSource", { field: `${valueLabel} ${position}` })}
                value={row.value}
                onChange={(binding) => edit(index, { value: { ...binding } })}
                editable={props.editable}
                target={workflowHttpRequestTarget(props.node.id, valuePath)}
                metadata={props.metadata}
                maxLength={header ? workflowHttpRequestLimits.headerValue : 50_000}
                allowNull={!header}
                nullLabel={t("configurationNullValue")}
                error={fieldError(props.validation, valuePath, t)}
              />
            )}
          </div>
        );
      })}
      {props.editable && (
        <Button
          size="sm"
          variant="outline"
          disabled={rows.length >= limit}
          onClick={() => onChange([...rows, { name: "", value: { ...emptyBinding } }])}
        >
          <WorkflowReferenceIcon name="plus" size={14} />
          {header ? copyFor.addHeader : copyFor.addField}
        </Button>
      )}
    </div>
  );
}

function TextBody({
  value,
  onChange,
  ...props
}: EntryProps & { value: Config[string] | undefined; onChange: (value: DraftBinding) => void }) {
  const t = useAppTranslations("workflows");
  const labels = copy[useLocale()];
  const id = useId();
  const parsed = draftBindingSchema.safeParse(value);
  const literal =
    parsed.success && parsed.data.kind === "value" && typeof parsed.data.value === "string"
      ? parsed.data.value
      : "";
  const path = ["body", "value"];
  const error = fieldError(props.validation, path, t);
  return (
    <BindingField
      definition={props.definition}
      nodeId={props.node.id}
      kind="text"
      label={labels.body}
      sourceLabel={t("recordCreateFieldSource", { field: labels.body })}
      value={value}
      editable={props.editable}
      target={workflowHttpRequestTarget(props.node.id, path)}
      metadata={props.metadata}
      error={error}
      onChange={onChange}
      allowLiteral={false}
      literalControlLabel={t("literalValue")}
      literalControl={(errorId) => (
        <div className={styles.field}>
          <label htmlFor={id}>{labels.body}</label>
          <Textarea
            id={id}
            dir="auto"
            value={literal}
            disabled={!props.editable}
            maxLength={50_000}
            aria-invalid={error !== undefined}
            aria-describedby={error === undefined ? undefined : errorId}
            onChange={(event) => onChange({ kind: "value", value: event.currentTarget.value })}
          />
        </div>
      )}
    />
  );
}

function RequestBody({ onConfigChange, ...props }: SectionProps) {
  const labels = copy[useLocale()];
  const config = props.node.config;
  const body = object(config.body);
  const selected = body.kind === "text" || body.kind === "json" ? body.kind : "none";
  function change(next: Config | undefined) {
    if (!props.editable) return;
    const changed = { ...config };
    if (next === undefined) delete changed.body;
    else changed.body = next;
    onConfigChange(changed);
  }
  return (
    <fieldset className={styles.field}>
      <legend className={styles.label}>{labels.body}</legend>
      <Select
        ariaLabel={labels.bodyMode}
        value={selected}
        disabled={!props.editable}
        options={[
          { value: "none", label: labels.none },
          { value: "text", label: labels.text },
          { value: "json", label: labels.json },
        ]}
        onChange={(next) => {
          if (next === "none") change(undefined);
          else if (next === "text") change({ kind: "text", value: { ...emptyBinding } });
          else if (next === "json") change({ kind: "json", fields: [] });
        }}
      />
      {selected === "text" && (
        <TextBody
          {...props}
          value={body.value}
          onChange={(value) => change({ kind: "text", value: { ...value } })}
        />
      )}
      {selected === "json" && (
        <KeyValueEntries
          {...props}
          header={false}
          rows={entries(body.fields)}
          onChange={(fields) => change({ kind: "json", fields })}
        />
      )}
      {selected !== "none" && <p className={styles.hint}>{labels.bodyHint}</p>}
    </fieldset>
  );
}

function ResponseFields({ onConfigChange, ...props }: SectionProps) {
  const t = useAppTranslations("workflows");
  const labels = copy[useLocale()];
  const format = useFormatters();
  const rows = entries(props.node.config.response);
  function update(response: Config[]) {
    if (props.editable) onConfigChange({ ...props.node.config, response });
  }
  function edit(index: number, patch: Config) {
    update(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  }
  return (
    <fieldset className={styles.field}>
      <legend className={styles.label}>{labels.response}</legend>
      <p className={styles.hint}>{labels.responseHint}</p>
      {rows.map((row, index) => {
        const position = format.number(index + 1);
        const label = `${labels.responseName} ${position}`;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: Serialized projection entries are positional.
          <div key={index} className={rowClass}>
            <RowName
              label={label}
              value={textValue(row.name)}
              editable={props.editable}
              onChange={(name) => edit(index, { name })}
              removeLabel={`${labels.remove} ${label}`}
              onRemove={() => update(rows.filter((_, rowIndex) => rowIndex !== index))}
            />
            <Select
              ariaLabel={`${labels.responseType} ${position}`}
              value={textValue(row.type)}
              disabled={!props.editable}
              options={responseTypes.map((type) => ({
                value: type,
                label: t(`mappingTypes.${type}`),
              }))}
              onChange={(type) => edit(index, { type })}
            />
            <ToggleField
              label={labels.nullable}
              accessibleLabel={`${labels.nullable} ${label}`}
              checked={row.nullable === true}
              disabled={!props.editable}
              onCheckedChange={(nullable) => edit(index, { nullable })}
            />
          </div>
        );
      })}
      {props.editable && (
        <Button
          size="sm"
          variant="outline"
          disabled={rows.length >= workflowHttpRequestLimits.fields}
          onClick={() => update([...rows, { name: "", type: "text" }])}
        >
          <WorkflowReferenceIcon name="plus" size={14} />
          {labels.addResponse}
        </Button>
      )}
    </fieldset>
  );
}

export function HttpRequestConfigurationFields({ onChange, ...props }: Props) {
  const t = useAppTranslations("workflows");
  const labels = copy[useLocale()];
  const config = props.node.config;
  const method = workflowHttpMethods.find((candidate) => candidate === config.method) ?? "GET";
  function change(next: Config) {
    if (props.editable) onChange({ ...props.node, config: next });
  }
  return (
    <div className={`space-y-4 ${MASK_CLASS}`}>
      <div className={styles.field}>
        <p className={styles.hint}>{labels.policy}</p>
        <p className={styles.hint}>{labels.live}</p>
      </div>
      <BindingField
        definition={props.definition}
        nodeId={props.node.id}
        kind="text"
        label={t("httpRequestUrl")}
        sourceLabel={t("recordCreateFieldSource", { field: t("httpRequestUrl") })}
        value={config.url}
        editable={props.editable}
        target={workflowHttpRequestTarget(props.node.id, ["url"])}
        metadata={props.metadata}
        maxLength={workflowHttpRequestLimits.url}
        error={fieldError(props.validation, ["url"], t)}
        onChange={(url) => change({ ...config, url: { ...url } })}
      />
      <div className={styles.field}>
        <p className={styles.label}>{labels.method}</p>
        <Select
          ariaLabel={labels.method}
          value={method}
          disabled={!props.editable}
          options={workflowHttpMethods.map((value) => ({ value, label: value }))}
          onChange={(next) => {
            const updated: Config = { ...config, method: next };
            if (next === "GET") delete updated.body;
            change(updated);
          }}
        />
      </div>
      <fieldset className={styles.field}>
        <legend className={styles.label}>{labels.headers}</legend>
        <KeyValueEntries
          {...props}
          header
          rows={entries(config.headers)}
          onChange={(headers) => change({ ...config, headers })}
        />
      </fieldset>
      {method !== "GET" && <RequestBody {...props} onConfigChange={change} />}
      <ResponseFields {...props} onConfigChange={change} />
    </div>
  );
}
