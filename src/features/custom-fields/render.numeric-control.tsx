"use client";
import { Input } from "@/components/ui/Input";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import { numericCustomFieldError } from "./inputValidation";
import type { ControlProps } from "./render.widget-types";
import { strVal } from "./render.widget-types";
export function NumericControl({
  id,
  def,
  value,
  onChange,
  min,
  max,
  hideValidationMessage,
}: ControlProps & { id: string; step?: string; min?: number; max?: number }) {
  const locale = useLocale();
  const format = useFormatters();
  const error = numericCustomFieldError(def, value, locale, min, max);
  const errorId = `${id}-error`;
  const shown =
    typeof value === "number"
      ? format.number(value, { useGrouping: false, maximumFractionDigits: 20 })
      : strVal(value);
  return (
    <div>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={shown}
        aria-label={def.name}
        aria-invalid={error !== null || undefined}
        aria-describedby={error !== null && hideValidationMessage !== true ? errorId : undefined}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          if (raw.trim() === "") {
            onChange(null);
            return;
          }
          const normalized = normalizeNumberInput(raw, locale);
          const number = normalized === null ? NaN : Number(normalized);
          // Invalid drafts remain visible strings and fail schema validation; they never turn into a
          // different valid value or reuse the previous numeric draft at commit time.
          onChange(
            normalized === null ||
              !Number.isFinite(number) ||
              numericCustomFieldError(def, number, locale, min, max) !== null
              ? raw
              : number,
          );
        }}
        className="h-8 px-2 py-1"
      />
      {error !== null && hideValidationMessage !== true && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
