"use client";

import { useId } from "react";
import { Input } from "@/components/ui/Input";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { normalizeDigits } from "@/utils/normalizeNumberInput";
import { delayMinutesSchema } from "../registry";
import { type Binding, bindingSchema } from "../schemas";

export function DelayFields({
  value,
  editable,
  onChange,
  error,
}: {
  value: unknown;
  editable: boolean;
  onChange: (binding: Binding) => void;
  error?: string;
}) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  const min = delayMinutesSchema.minValue;
  const max = delayMinutesSchema.maxValue;
  const id = useId();
  const parsed = bindingSchema.safeParse(value);
  const mapped = parsed.success && parsed.data.kind === "reference";
  const literal = parsed.success && parsed.data.kind === "value" ? parsed.data.value : "";
  const text = typeof literal === "number" || typeof literal === "string" ? String(literal) : "";
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {t("delayMinutesLabel")}
      </label>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        dir="ltr"
        value={text}
        disabled={!editable}
        aria-describedby={[
          `${id}-hint`,
          mapped ? `${id}-literal-required` : undefined,
          error === undefined ? undefined : `${id}-error`,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={!delayMinutesSchema.safeParse(literal).success}
        onChange={(event) => {
          const raw = event.target.value;
          const normalized = normalizeDigits(raw);
          const minutes = /^\d+$/.test(normalized)
            ? delayMinutesSchema.safeParse(Number(normalized))
            : null;
          onChange({ kind: "value", value: minutes?.success === true ? minutes.data : raw });
        }}
      />
      <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
        {t("delayMinutesHint", {
          min: min === null ? "" : fmt.number(min),
          max: max === null ? "" : fmt.number(max),
        })}
      </p>
      {error !== undefined && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
      {mapped && (
        <p id={`${id}-literal-required`} className="text-xs leading-5 text-destructive">
          {t("delayLiteralRequired")}
        </p>
      )}
    </div>
  );
}
