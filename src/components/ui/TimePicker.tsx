"use client";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { FIELD_INPUT as FIELD } from "@/constants/formStyles";
import { useAppTranslations, useLocale, useNumberingSystem } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { Input } from "./Input";
import { formatTimeInput, maskTime } from "./timeFormat";

interface TimePickerProps {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}
interface TimeDraft {
  source: string;
  draft: string;
  editing: boolean;
  invalid: boolean;
}
function initialDraft(value: string): TimeDraft {
  return { source: value, draft: value, editing: false, invalid: false };
}
function invalidTime(value: string): boolean {
  return value.trim() !== "" && maskTime(value) === "";
}

// Raw edits belong to the user until blur/Enter. Display preferences only reformat pristine
// values; an external canonical value change still replaces the draft immediately.
export function TimePicker({ value, onChange, ariaLabel }: TimePickerProps): React.ReactNode {
  const locale = useLocale();
  const numberingSystem = useNumberingSystem();
  const t = useAppTranslations("sharedUi");
  const errorMessage = t("invalidTime");
  const errorId = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [stored, setStored] = useState(() => initialDraft(value));
  const current = stored.source === value ? stored : initialDraft(value);
  if (stored.source !== value) setStored(current);
  const invalidValue = invalidTime(current.draft);
  useEffect(() => {
    ref.current?.setCustomValidity(invalidValue ? errorMessage : "");
  }, [invalidValue, errorMessage]);

  function commit(): boolean {
    if (invalidValue) {
      ref.current?.setCustomValidity(errorMessage);
      setStored({ ...current, invalid: true });
      return false;
    }
    const masked = maskTime(current.draft);
    ref.current?.setCustomValidity("");
    setStored({ source: value, draft: masked, editing: false, invalid: false });
    if (masked !== value) onChange(masked);
    return true;
  }

  return (
    <div className="min-w-0">
      <Input
        ref={ref}
        data-time-picker=""
        dir="ltr"
        aria-label={ariaLabel}
        aria-invalid={current.invalid || undefined}
        aria-describedby={current.invalid ? errorId : undefined}
        inputMode="numeric"
        placeholder={t("timePlaceholder")}
        value={
          current.editing ? current.draft : formatTimeInput(current.draft, locale, numberingSystem)
        }
        onChange={(e) => {
          const raw = e.target.value;
          const invalid = invalidTime(raw);
          e.currentTarget.setCustomValidity(invalid ? errorMessage : "");
          setStored({
            source: value,
            draft: raw,
            editing: true,
            invalid: current.invalid && invalid,
          });
        }}
        onBlur={commit}
        onInvalid={() => setStored({ ...current, invalid: true })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !commit()) e.preventDefault();
        }}
        className={cn(FIELD, "w-24")}
      />
      {current.invalid && (
        <p id={errorId} role="alert" className="mt-1 max-w-64 text-xs text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
