"use client";

import { useId } from "react";
import { Select, type SelectOption } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import styles from "./workflowInspector.module.css";

export function RecordQuerySelect({
  label,
  value,
  editable,
  options,
  error,
  onChange,
}: {
  label: string;
  value: string;
  editable: boolean;
  options: SelectOption[];
  error?: string;
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
        disabled={!editable}
        placeholder={t("chooseValue")}
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
