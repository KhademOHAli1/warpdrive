"use client";

import { useId } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { delayUntilDate } from "../delayConfig";
import { typedLiteralFromInput } from "../mappingLiteralIntent";
import { delayMinutesSchema } from "../registry";
import { draftBindingSchema, type WorkflowNode } from "../schemas";
import { DelayFields } from "./DelayFields";
import { WaitTimestamp } from "./WaitTimestamp";

function instantText(binding: unknown): string {
  if (typeof binding !== "object" || binding === null || !("value" in binding)) return "";
  const value = binding.value;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

export function DelayConfigurationFields({
  config,
  editable,
  onChange,
  error,
}: {
  config: WorkflowNode["config"];
  editable: boolean;
  onChange: (config: WorkflowNode["config"]) => void;
  error?: string;
}) {
  const t = useAppTranslations("workflows");
  const format = useFormatters();
  const id = useId();
  const mode = Object.hasOwn(config, "until") ? "until" : "duration";
  const parsed = draftBindingSchema.safeParse(config.until);
  const date =
    parsed.success && parsed.data.kind === "value" && parsed.data.literalType === "instant"
      ? delayUntilDate(parsed.data.value)
      : null;
  const mapped = parsed.success && parsed.data.kind === "reference";
  const text = instantText(config.until);
  const feedback = error ?? (date === null ? t("delayUntilInvalid") : undefined);
  const max = delayMinutesSchema.maxValue;
  return (
    <div className="space-y-3">
      <Select
        ariaLabel={t("delayModeLabel")}
        value={mode}
        disabled={!editable}
        options={[
          { value: "duration", label: t("delayModeDuration") },
          { value: "until", label: t("delayModeUntil") },
        ]}
        onChange={(next) => {
          if (!editable || next === mode) return;
          if (next === "until") onChange({ until: { ...typedLiteralFromInput("instant", "") } });
          else if (next === "duration") onChange({ minutes: { kind: "value", value: "" } });
        }}
      />
      {mode === "duration" ? (
        <DelayFields
          value={config.minutes}
          editable={editable}
          error={error}
          onChange={(binding) => {
            if (editable && JSON.stringify(binding) !== JSON.stringify(config.minutes))
              onChange({ ...config, minutes: binding });
          }}
        />
      ) : (
        <div className="space-y-2">
          <label htmlFor={id} className="text-sm font-medium">
            {t("delayUntilLabel")}
          </label>
          <Input
            id={id}
            type="text"
            dir="ltr"
            value={text}
            disabled={!editable}
            maxLength={50_000}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={date === null || error !== undefined}
            aria-describedby={[
              `${id}-hint`,
              `${id}-limit`,
              mapped ? `${id}-literal-required` : undefined,
              feedback === undefined ? undefined : `${id}-error`,
            ]
              .filter(Boolean)
              .join(" ")}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              if (editable && raw !== text)
                onChange({ ...config, until: { ...typedLiteralFromInput("instant", raw) } });
            }}
          />
          <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
            {t("delayUntilHint")}
          </p>
          <p id={`${id}-limit`} className="text-xs leading-5 text-muted-foreground">
            {t("delayUntilLimit", { max: max === null ? "" : format.number(max) })}
          </p>
          {feedback !== undefined && (
            <p id={`${id}-error`} className="text-xs text-destructive">
              {feedback}
            </p>
          )}
          {mapped && (
            <p id={`${id}-literal-required`} className="text-xs leading-5 text-destructive">
              {t("delayUntilLiteralRequired")}
            </p>
          )}
          {date !== null && (
            <p className="text-xs leading-5 text-muted-foreground">
              <WaitTimestamp
                value={date}
                label={t("delayUntilPreview")}
                precision="millisecond"
                exactValue={text}
              />
            </p>
          )}
        </div>
      )}
    </div>
  );
}
