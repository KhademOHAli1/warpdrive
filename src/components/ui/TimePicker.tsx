"use client";
import type React from "react";
import { FIELD_INPUT as FIELD } from "@/constants/formStyles";
import { useAppTranslations, useLocale, useNumberingSystem } from "@/features/i18n/LocaleProvider";
import { useSyncedState } from "@/lib/useSyncedState";
import { cn } from "@/lib/utils";
import { Input } from "./Input";
import { formatTimeInput, maskTime } from "./timeFormat";

interface TimePickerProps {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}

// Masked h:mm text field (Pipedrive parity). Local draft while typing; commits a
// normalized HH:mm (or "") to the parent on blur or Enter.
export function TimePicker({ value, onChange, ariaLabel }: TimePickerProps): React.ReactNode {
  const locale = useLocale();
  const numberingSystem = useNumberingSystem();
  const t = useAppTranslations("sharedUi");
  // Re-seeds when the parent commits a new value; an effect here would render the stale draft first.
  const [draft, setDraft] = useSyncedState(formatTimeInput(value, locale, numberingSystem));

  function commit(): void {
    const masked = maskTime(draft);
    setDraft(formatTimeInput(masked, locale, numberingSystem));
    if (masked !== value) onChange(masked);
  }

  return (
    <Input
      dir="ltr"
      aria-label={ariaLabel}
      inputMode="numeric"
      placeholder={t("timePlaceholder")}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      className={cn(FIELD, "w-24")}
    />
  );
}
