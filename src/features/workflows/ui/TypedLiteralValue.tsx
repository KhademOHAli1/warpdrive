"use client";
import { useId } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations, useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { numericLiteralFromInput, typedLiteralFromInput } from "../mappingLiteralIntent";
import type { MappingTarget, MappingValueKind } from "../mappingTypes";
import type { DraftValueBinding } from "../schemas";

type Intent = "text" | "number" | "boolean" | "date" | "instant" | "null";
interface Props {
  binding: DraftValueBinding;
  target: MappingTarget | undefined;
  editable: boolean;
  error?: string;
  onChange: (binding: DraftValueBinding) => void;
  label?: string;
  id?: string;
  errorId?: string;
  hideError?: boolean;
  maxLength?: number;
}
function literalIntent(binding: DraftValueBinding): Intent {
  if (binding.literalType !== undefined) return binding.literalType;
  if (binding.value === null) return "null";
  if (typeof binding.value === "number") return "number";
  return typeof binding.value === "boolean" ? "boolean" : "text";
}
function primaryIntent(kind: MappingValueKind | undefined): Intent {
  switch (kind) {
    case "number":
    case "date":
    case "instant":
    case "boolean":
      return kind;
    default:
      return "text";
  }
}
function intentChoices(target: MappingTarget | undefined, intent: Intent): Intent[] {
  const kinds: Intent[] =
    target?.contract.kind === "scalar"
      ? ["text", "number", "boolean", "date", "instant"]
      : [primaryIntent(target?.contract.kind)];
  if (!kinds.includes(intent)) kinds.push(intent);
  if (target?.contract.nullable === true && !kinds.includes("null")) kinds.push("null");
  return kinds;
}
function typeChanged(intent: Intent, binding: DraftValueBinding): DraftValueBinding {
  if (intent === "null") return { kind: "value", value: null };
  if (intent === "boolean") return { kind: "value", value: true };
  if (intent === "number" || intent === "date" || intent === "instant")
    return { kind: "value", value: "", literalType: intent };
  return { kind: "value", value: typeof binding.value === "string" ? binding.value : "" };
}
function inputBinding(
  intent: Intent,
  raw: string,
  locale: ReturnType<typeof useLocale>,
): DraftValueBinding {
  if (intent === "number") return numericLiteralFromInput(raw, locale);
  if (intent === "date" || intent === "instant") return typedLiteralFromInput(intent, raw);
  return { kind: "value", value: raw };
}
function LiteralType({
  binding,
  target,
  intent,
  name,
  editable,
  onChange,
}: Pick<Props, "binding" | "target" | "editable" | "onChange"> & { intent: Intent; name: string }) {
  const t = useAppTranslations("workflows");
  const messages = useMessages().workflows;
  const kinds = intentChoices(target, intent);
  if (kinds.length <= 1) return null;
  return (
    <Select
      ariaLabel={name + " · " + t("mappingLiteralType")}
      value={intent}
      disabled={!editable}
      options={kinds.map((kind) => ({
        value: kind,
        label: kind === "null" ? messages.configurationNullValue : messages.mappingTypes[kind],
      }))}
      onChange={(raw) => {
        const next = kinds.find((kind) => kind === raw);
        if (editable && next !== undefined && next !== intent) onChange(typeChanged(next, binding));
      }}
    />
  );
}
function LiteralInput({
  binding,
  intent,
  name,
  editable,
  onChange,
  error,
  id,
  errorId,
  maxLength,
}: Pick<Props, "binding" | "editable" | "onChange" | "error" | "id" | "errorId" | "maxLength"> & {
  intent: Intent;
  name: string;
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const format = useFormatters();
  if (intent === "null") return <p>{t("configurationNullValue")}</p>;
  if (intent === "boolean")
    return (
      <Select
        ariaLabel={name}
        value={binding.value === true ? "true" : "false"}
        disabled={!editable}
        options={[
          { value: "true", label: t("boolTrue") },
          { value: "false", label: t("boolFalse") },
        ]}
        onChange={(raw) => {
          if (editable) onChange({ kind: "value", value: raw === "true" });
        }}
      />
    );
  const shown =
    typeof binding.value === "number"
      ? format.number(binding.value, { useGrouping: false, maximumSignificantDigits: 21 })
      : typeof binding.value === "string"
        ? binding.value
        : "";
  return (
    <Input
      id={id}
      aria-label={name}
      inputMode={intent === "number" ? "decimal" : undefined}
      dir={intent === "text" ? "auto" : "ltr"}
      value={shown}
      disabled={!editable}
      maxLength={maxLength}
      aria-invalid={error !== undefined}
      aria-describedby={error === undefined ? undefined : errorId}
      onChange={(event) => {
        if (editable) onChange(inputBinding(intent, event.currentTarget.value, locale));
      }}
    />
  );
}
export function TypedLiteralValue({
  binding,
  target,
  editable,
  error,
  onChange,
  label,
  id,
  errorId,
  hideError = false,
  maxLength = 50000,
}: Props) {
  const t = useAppTranslations("workflows");
  const generatedId = useId();
  const descriptionId = errorId ?? generatedId;
  const name = label ?? t("literalValue");
  const intent = literalIntent(binding);
  return (
    <fieldset
      aria-label={name + " · " + t("mappingLiteralType")}
      aria-invalid={error !== undefined}
      aria-describedby={error === undefined ? undefined : descriptionId}
      className="min-w-0 space-y-2"
    >
      <LiteralType
        binding={binding}
        target={target}
        intent={intent}
        name={name}
        editable={editable}
        onChange={onChange}
      />
      <LiteralInput
        binding={binding}
        intent={intent}
        name={name}
        editable={editable}
        onChange={onChange}
        error={error}
        id={id}
        errorId={descriptionId}
        maxLength={maxLength}
      />
      {error !== undefined && !hideError && (
        <p id={descriptionId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
