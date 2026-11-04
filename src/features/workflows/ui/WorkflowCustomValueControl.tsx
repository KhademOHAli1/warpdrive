"use client";

import { type ChangeEvent, useId } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { formatTimeInput, maskTime } from "@/components/ui/timeFormat";
import { buildCustomFieldsSchema } from "@/features/custom-fields/validate";
import { useAppTranslations, useLocale, useNumberingSystem } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { CustomFieldDef } from "@/types/customFields";
import { assertNever } from "@/types/result";
import { normalizeDigits } from "@/utils/normalizeNumberInput";
import {
  customNumberDraft,
  customObjectPatch,
  customObjectValue,
  customTextValue,
} from "./workflowCustomControlValues";

export interface WorkflowCustomReference {
  status: "loading" | "ready" | "error" | "denied";
  options: readonly { id: string; label: string }[];
  search: string;
  onSearch: (search: string) => void;
  nextCursor: string | null;
  loadingMore?: boolean;
  onMore?: () => void;
  retry?: () => void;
}

export interface WorkflowCustomValueControlProps {
  def: CustomFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  editable: boolean;
  error?: string;
  reference?: WorkflowCustomReference;
}

type ValueProps = Pick<WorkflowCustomValueControlProps, "def" | "value" | "onChange">;

function TextValue({ def, value, onChange }: ValueProps) {
  const props = {
    "aria-label": def.name,
    value: customTextValue(value),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = event.currentTarget.value;
      onChange(next);
    },
    dir: def.type === "phone" ? ("ltr" as const) : ("auto" as const),
  };
  if (def.type === "large_text") return <Textarea {...props} maxLength={65535} />;
  return (
    <Input
      {...props}
      maxLength={def.type === "phone" ? undefined : 255}
      inputMode={def.type === "phone" ? "tel" : undefined}
    />
  );
}

function NumberValue({ def, value, onChange }: ValueProps) {
  const locale = useLocale();
  const format = useFormatters();
  const shown =
    typeof value === "number"
      ? format.number(value, { useGrouping: false, maximumFractionDigits: 20 })
      : customTextValue(value);
  return (
    <Input
      aria-label={def.name}
      inputMode="decimal"
      value={shown}
      onChange={(event) =>
        onChange(customNumberDraft(event.currentTarget.value, locale, def.type === "monetary"))
      }
    />
  );
}

function TimeValue({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const locale = useLocale();
  const numbering = useNumberingSystem();
  const t = useAppTranslations("sharedUi");
  const text = customTextValue(value);
  return (
    <Input
      aria-label={label}
      dir="ltr"
      inputMode="numeric"
      placeholder={t("timePlaceholder")}
      value={formatTimeInput(text, locale, numbering)}
      onChange={(event) => {
        const next = normalizeDigits(event.currentTarget.value);
        onChange(next === "" ? undefined : next);
      }}
      onBlur={() => {
        if (!/^(?:\d{1,4}|\d{1,2}:\d{0,2})$/.test(text.trim())) return;
        const canonical = maskTime(text);
        if (canonical !== "" && canonical !== text) onChange(canonical);
      }}
    />
  );
}

function RangeValue({ def, value, onChange }: ValueProps) {
  const t = useAppTranslations("customFields");
  const current = customObjectValue(value);
  return (
    <div className="space-y-2">
      {(["start", "end"] as const).map((part) => {
        const label = t(part === "start" ? "rangeStart" : "rangeEnd", { name: def.name });
        const change = (next: unknown) => onChange(customObjectPatch(value, part, next));
        return (
          <div key={part} className="space-y-1">
            <p className="text-xs text-muted-foreground">{t(part)}</p>
            {def.type === "date_range" ? (
              <DatePicker
                ariaLabel={label}
                value={customTextValue(current[part]) || null}
                onChange={(next) => change(next ?? undefined)}
              />
            ) : (
              <TimeValue label={label} value={current[part]} onChange={change} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function OptionValue({ def, value, onChange }: ValueProps) {
  const t = useAppTranslations("customFields");
  const active = def.options.filter((option) => option.archived !== true);
  if (def.type === "single_option") {
    return (
      <Select
        ariaLabel={def.name}
        value={customTextValue(value)}
        placeholder={t("select")}
        options={active.map((option) => ({ value: option.id, label: option.label }))}
        onChange={(next) => {
          if (active.some((option) => option.id === next)) onChange(next);
        }}
      />
    );
  }
  const selected = Array.isArray(value) ? value : [];
  return (
    <div className="space-y-1">
      {active.map((option) => (
        <div key={option.id} className="flex items-center gap-2">
          <Checkbox
            label={option.label}
            checked={selected.includes(option.id)}
            onCheckedChange={(checked) =>
              onChange(
                checked ? [...selected, option.id] : selected.filter((id) => id !== option.id),
              )
            }
          />
          <bdi dir="auto">{option.label}</bdi>
        </div>
      ))}
    </div>
  );
}

function AddressValue({ def, value, onChange }: ValueProps) {
  const t = useAppTranslations("customFields");
  const w = useAppTranslations("workflows");
  const locale = useLocale();
  const format = useFormatters();
  const current = customObjectValue(value);
  const addressId = useId();
  return (
    <div className="space-y-2">
      {(["street", "city", "region", "postal", "country"] as const).map((part) => (
        <label key={part} htmlFor={`${addressId}-${part}`} className="block text-xs">
          {t(part)}
          <Input
            id={`${addressId}-${part}`}
            aria-label={`${def.name}: ${t(part)}`}
            dir="auto"
            value={customTextValue(current[part])}
            onChange={(event) =>
              onChange(customObjectPatch(value, part, event.currentTarget.value || undefined))
            }
          />
        </label>
      ))}
      {(["lat", "lng"] as const).map((part) => {
        const label = w(part === "lat" ? "customLatitude" : "customLongitude");
        const coordinate = current[part];
        const shown =
          typeof coordinate === "number"
            ? format.number(coordinate, { useGrouping: false, maximumFractionDigits: 20 })
            : customTextValue(coordinate);
        return (
          <label key={part} htmlFor={`${addressId}-${part}`} className="block text-xs">
            {label}
            <Input
              id={`${addressId}-${part}`}
              aria-label={`${def.name}: ${label}`}
              inputMode="decimal"
              value={shown}
              onChange={(event) =>
                onChange(
                  customObjectPatch(
                    value,
                    part,
                    customNumberDraft(event.currentTarget.value, locale),
                  ),
                )
              }
            />
          </label>
        );
      })}
    </div>
  );
}

function ReferenceValue({
  def,
  value,
  onChange,
  reference,
  editable,
}: ValueProps & Pick<WorkflowCustomValueControlProps, "reference" | "editable">) {
  const t = useAppTranslations("customFields");
  const w = useAppTranslations("workflows");
  const ready = reference?.status === "ready";
  const options = ready ? reference.options : [];
  return (
    <div className="space-y-2">
      <Input
        aria-label={w("customReferenceSearch")}
        value={reference?.search ?? ""}
        disabled={!editable || reference === undefined || reference.status === "denied"}
        onChange={(event) => {
          if (editable && reference !== undefined && reference.status !== "denied")
            reference.onSearch(event.currentTarget.value);
        }}
      />
      <Select
        ariaLabel={def.name}
        value={customTextValue(value)}
        placeholder={t("select")}
        disabled={!editable || !ready}
        options={options.map((option) => ({ value: option.id, label: option.label }))}
        onChange={(next) => {
          if (ready && options.some((option) => option.id === next)) onChange(next);
        }}
      />
      {reference?.status === "loading" && <p role="status">{t("loading")}</p>}
      {reference?.status === "error" && reference.retry !== undefined && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (editable) reference.retry?.();
          }}
        >
          {w("retry")}
        </Button>
      )}
      {reference?.nextCursor != null && (
        <Button
          size="sm"
          variant="outline"
          disabled={!ready || reference.loadingMore === true || reference.onMore === undefined}
          onClick={() => {
            if (editable && ready) reference.onMore?.();
          }}
        >
          {w("customReferenceMore")}
        </Button>
      )}
    </div>
  );
}

function ValueControl(
  props: ValueProps & Pick<WorkflowCustomValueControlProps, "reference" | "editable">,
) {
  const { def, value, onChange } = props;
  switch (def.type) {
    case "text":
    case "autocomplete":
    case "large_text":
    case "phone":
      return <TextValue {...props} />;
    case "numeric":
    case "monetary":
      return <NumberValue {...props} />;
    case "date":
      return (
        <DatePicker
          ariaLabel={def.name}
          value={customTextValue(value) || null}
          onChange={(next) => onChange(next ?? undefined)}
        />
      );
    case "time":
      return <TimeValue label={def.name} value={value} onChange={onChange} />;
    case "date_range":
    case "time_range":
      return <RangeValue {...props} />;
    case "single_option":
    case "multi_option":
      return <OptionValue {...props} />;
    case "user":
    case "person":
    case "org":
      return <ReferenceValue {...props} />;
    case "address":
      return <AddressValue {...props} />;
    default:
      return assertNever(def.type);
  }
}

function referenceUnavailable(
  def: CustomFieldDef,
  reference: WorkflowCustomReference | undefined,
): boolean {
  const referenceType = def.type === "user" || def.type === "person" || def.type === "org";
  return (
    referenceType &&
    (reference === undefined || reference.status === "error" || reference.status === "denied")
  );
}

export function WorkflowCustomValueControl({
  def,
  value,
  onChange,
  editable,
  error,
  reference,
}: WorkflowCustomValueControlProps) {
  const t = useAppTranslations("customFields");
  const w = useAppTranslations("workflows");
  const errorId = useId();
  let issue = error;
  if (value === null) issue = w("customValueNull");
  if (
    issue === undefined &&
    !buildCustomFieldsSchema([def]).safeParse({ [def.key]: value }).success
  )
    issue = t("valueInvalid", { name: def.name });
  if (issue === undefined && referenceUnavailable(def, reference))
    issue =
      reference?.status === "denied"
        ? w("customReferenceDenied")
        : t("referenceUnavailable", { name: def.name });
  const change = (next: unknown) => {
    if (editable) onChange(next);
  };
  return (
    <fieldset
      aria-label={def.name}
      disabled={!editable}
      aria-invalid={issue !== undefined || undefined}
      aria-describedby={issue === undefined ? undefined : errorId}
      className="min-w-0 space-y-2"
    >
      <legend className="text-sm font-medium">
        <bdi dir="auto">{def.name}</bdi>
        {def.isRequired && <span>{t("required")}</span>}
      </legend>
      <ValueControl
        def={def}
        value={value}
        onChange={change}
        editable={editable}
        reference={reference}
      />
      {value === undefined && (
        <p className="text-xs text-muted-foreground">{w("customValueOmitted")}</p>
      )}
      {value !== undefined && (
        <Button size="sm" variant="ghost" onClick={() => change(undefined)}>
          {w("customValueClear")}
        </Button>
      )}
      {issue !== undefined && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {issue}
        </p>
      )}
    </fieldset>
  );
}
