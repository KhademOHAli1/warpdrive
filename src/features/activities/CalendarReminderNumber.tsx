"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/Input";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatNumber } from "@/lib/localeFormatting";
import { normalizeDigits } from "@/utils/normalizeNumberInput";

export interface ReminderInputStatus {
  dirty: boolean;
  valid: boolean;
}
interface NumberDraft {
  source: number;
  text: string;
  editing: boolean;
  touched: boolean;
}
function parse(raw: string, max: number): number | null {
  const normalized = normalizeDigits(raw.trim());
  if (!/^\d+$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
}
export function CalendarReminderNumber({
  value,
  max,
  label,
  caption,
  reveal = false,
  onChange,
  onStatus,
}: {
  value: number;
  max: number;
  label: string;
  caption: string;
  reveal?: boolean;
  onChange: (value: number) => void;
  onStatus: (status: ReminderInputStatus) => void;
}): React.ReactNode {
  const preferences = useLocalePreferences();
  const t = useAppTranslations("calendar");
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const initial = (source: number): NumberDraft => ({
    source,
    text: String(source),
    editing: false,
    touched: false,
  });
  const [stored, setStored] = useState(() => initial(value));
  const current = stored.source === value ? stored : initial(value);
  if (stored.source !== value) setStored(current);
  const parsed = parse(current.text, max);
  const valid = parsed !== null;
  const dirty = !valid || parsed !== value;
  const invalid = !valid && (current.touched || reveal);
  const message = t("reminders.invalidNumber", { min: 0, max });
  useEffect(() => {
    input.current?.setCustomValidity(valid ? "" : message);
  }, [valid, message]);
  useEffect(() => {
    onStatus({ dirty, valid });
  }, [dirty, valid, onStatus]);
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs text-muted-foreground">{caption}</p>
      <Input
        ref={input}
        data-reminder-input=""
        inputMode="numeric"
        dir="ltr"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? id : undefined}
        value={
          current.editing || parsed === null
            ? current.text
            : formatNumber(parsed, preferences, { useGrouping: false })
        }
        onChange={(event) => {
          const raw = event.target.value;
          const next = parse(raw, max);
          setStored({ source: next ?? value, text: raw, editing: true, touched: current.touched });
          if (next !== null) onChange(next);
        }}
        onBlur={() => setStored({ ...current, editing: false, touched: true })}
        onInvalid={() => setStored({ ...current, touched: true })}
        className="w-24"
      />
      {invalid && (
        <p id={id} role="alert" className="max-w-64 text-xs text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
