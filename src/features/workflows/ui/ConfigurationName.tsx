"use client";
import { type Ref, useId } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import type { ConfigurationSpec, ConfigurationValidation } from "../configurationTypes";
import { displayNodeName, isAutomaticNodeName } from "../nodeNames";
import type { WorkflowNode } from "../schemas";
import { configurationFieldError } from "./ConfigurationNodeFields";
export function ConfigurationName({
  node,
  editable,
  onChange,
  nameInputRef,
  spec,
  validation,
}: {
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  nameInputRef?: Ref<HTMLInputElement>;
  spec: ConfigurationSpec | null;
  validation: ConfigurationValidation;
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const id = useId();
  const name = displayNodeName(node, locale);
  const automatic = isAutomaticNodeName(node);
  const error = configurationFieldError(validation, "name", t);
  return (
    <div className="space-y-3">
      <label htmlFor={id} className="text-sm font-medium">
        {t("stepName")}
      </label>
      <Input
        ref={nameInputRef}
        dir="auto"
        id={id}
        value={name}
        maxLength={
          spec?.fields.find((field) => field.control === "name")?.constraints?.maxLength ?? 120
        }
        disabled={!editable}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : id + "-error"}
        onChange={(event) => {
          if (editable) onChange({ ...node, name: event.target.value, nameMode: "custom" });
        }}
      />
      {error !== undefined && (
        <p id={id + "-error"} className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Checkbox
          id={id + "-auto"}
          label={t("stepNameAutomatic")}
          checked={automatic}
          disabled={!editable}
          onCheckedChange={(value) => {
            if (editable) onChange({ ...node, name, nameMode: value ? "automatic" : "custom" });
          }}
        />
        <label className="text-xs font-medium" htmlFor={id + "-auto"}>
          {t("stepNameAutomatic")}
        </label>
      </div>
    </div>
  );
}
