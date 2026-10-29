"use client";
import type React from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { Select, type SelectOption } from "@/components/ui/Select";
import { DATE_PRESET_KEYS, isDatePreset } from "@/constants/dateFilterPresets";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

const EXACT_DATE = "exact";

interface DateConditionValueProps {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
}

export function DateConditionValue({
  ariaLabel,
  value,
  onChange,
}: DateConditionValueProps): React.ReactNode {
  const t = useAppTranslations("filters");
  const periodOptions: SelectOption[] = [
    { value: EXACT_DATE, label: t("exactDate") },
    ...DATE_PRESET_KEYS.map((key) => ({ value: key, label: t(`presets.${key}`) })),
  ];
  const preset = isDatePreset(value);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Select
        ariaLabel={t("periodLabel", { label: ariaLabel })}
        value={preset ? value : EXACT_DATE}
        onChange={(v) => onChange(v === EXACT_DATE ? "" : v)}
        options={periodOptions}
        triggerClassName="min-w-0 flex-1"
      />
      {preset ? null : (
        <div className="min-w-0 flex-1">
          <DatePicker
            ariaLabel={ariaLabel}
            value={value === "" ? null : value}
            onChange={(v) => onChange(v ?? "")}
            placeholder={t("value")}
            triggerClassName="w-full rounded-md border px-2 py-1 text-start text-sm hover:bg-accent"
          />
        </div>
      )}
    </div>
  );
}
