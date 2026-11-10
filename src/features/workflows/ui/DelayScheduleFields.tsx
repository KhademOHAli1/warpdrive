"use client";

import { Braces, X } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { TimePicker } from "@/components/ui/TimePicker";
import {
  useAppTranslations,
  useLocalePreferences,
  useMessages,
} from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { instantParts, wallTimeToInstant } from "@/lib/zonedDateTime";
import type { ConfigurationMetadata, ConfigurationValidation } from "../configurationTypes";
import { delayDurationUnits, delayUntilDate } from "../delayConfig";
import { applyMappingSelection, describeMappingTarget } from "../mappingCatalog";
import {
  isMappingDate,
  numericLiteralFromInput,
  typedLiteralFromInput,
} from "../mappingLiteralIntent";
import {
  type DraftBinding,
  draftBindingSchema,
  type WorkflowDefinition,
  type WorkflowNode,
} from "../schemas";
import { configurationIssueKeys } from "./configurationIssueMessage";
import { buildMappingPickerModel, mappingSourceView } from "./mappingView";
import { focusAvailable } from "./useDialogFocus";
import { VariablePicker } from "./VariablePicker";
import { WaitTimestamp } from "./WaitTimestamp";

interface Props {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  validation: ConfigurationValidation;
  metadata: ConfigurationMetadata;
}

function DelayScheduleField({
  definition,
  node,
  editable,
  onChange,
  validation,
  metadata,
  label,
  path,
  raw,
  onClear,
  children,
}: Props & {
  label: string;
  path: readonly string[];
  raw: unknown;
  onClear: () => void;
  children: (errorId?: string) => ReactNode;
}) {
  const t = useAppTranslations("workflows");
  const { locale } = useLocalePreferences();
  const messages = useMessages().workflows;
  const format = useFormatters();
  const labelId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const described = describeMappingTarget(definition, node.id, path, metadata);
  const target = described.state === "ready" ? described.target : undefined;
  const model = buildMappingPickerModel(definition, node.id, target, raw, metadata, editable);
  const binding = draftBindingSchema.safeParse(raw);
  const mapped = binding.success && binding.data.kind === "reference";
  const source = mappingSourceView(
    model,
    model.selected.source,
    locale,
    messages.fields,
    format.number,
  );
  const issue = validation.issues.find((entry) =>
    path.every((part, index) => entry.path[index] === part),
  );
  const errorId = issue === undefined ? undefined : `${labelId}-error`;
  const canChoose = editable && model.state === "ready" && (mapped || model.choices.length > 0);
  return (
    <fieldset className="min-w-0 space-y-1.5" aria-describedby={errorId}>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="min-w-0 flex-1">
          {mapped ? (
            <bdi
              className="block truncate rounded border bg-muted/30 px-2 py-1.5 text-xs"
              dir="auto"
            >
              {source === undefined
                ? t("unavailableValue")
                : `${source.field} · ${source.name} ${source.number}`}
            </bdi>
          ) : (
            children(errorId)
          )}
        </div>
        {canChoose && (
          <Button
            ref={opener}
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`${label} · ${t("mappingChooseSource")}`}
            onClick={() => setOpen(true)}
          >
            <Braces className="size-4" />
          </Button>
        )}
        {editable && mapped && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`${label} · ${t("mappingRemove")}`}
            onClick={onClear}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      {source?.kind === "date" && path[0] === "scheduledDateTime" && (
        <p className="text-xs text-muted-foreground">{t("delayMappedDateOnly")}</p>
      )}
      {issue !== undefined && (
        <p id={errorId} className="text-xs text-destructive">
          {t(configurationIssueKeys[issue.code])}
        </p>
      )}
      <VariablePicker
        open={open}
        model={model}
        onChoose={(reference) => {
          if (target === undefined) return;
          const result = applyMappingSelection(
            definition,
            node.id,
            target,
            reference,
            metadata,
            editable,
          );
          if (!result.ok) return;
          const next = result.definition.nodes.find((entry) => entry.id === node.id);
          if (result.changed && next !== undefined) onChange(next);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusAvailable(opener.current);
        }}
      />
    </fieldset>
  );
}

function literalValue(raw: unknown) {
  const binding = draftBindingSchema.safeParse(raw);
  return binding.success && binding.data.kind === "value" ? binding.data.value : undefined;
}

function DateTimeFields({
  raw,
  editable,
  onChange,
}: {
  raw: unknown;
  editable: boolean;
  onChange: (binding: DraftBinding) => void;
}) {
  const t = useAppTranslations("workflows");
  const { timeZone } = useLocalePreferences();
  const value = literalValue(raw);
  const instant = delayUntilDate(value);
  if (!editable)
    return instant === null ? (
      t("setupRequired")
    ) : (
      <WaitTimestamp value={instant} label={t("delayUntilPreview")} precision="millisecond" />
    );
  const partial =
    typeof value === "string" ? /^(\d{4}-\d{2}-\d{2})?(?:T(\d{2}:\d{2}))?$/.exec(value) : null;
  const { date, time } =
    instant === null
      ? { date: partial?.[1] ?? "", time: partial?.[2] ?? "" }
      : instantParts(instant, timeZone);

  function setScheduledInput(nextDate: string, nextTime: string) {
    if (nextDate === date && nextTime === time) return;
    let next = `${nextDate}${nextTime === "" ? "" : `T${nextTime}`}`;
    if (nextDate !== "" && nextTime !== "") {
      try {
        next = wallTimeToInstant(nextDate, nextTime, timeZone).iso;
      } catch {
        // Keep nonexistent wall times editable and invalid until corrected.
      }
    }
    onChange(typedLiteralFromInput("instant", next));
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <DatePicker
          value={isMappingDate(date) ? date : null}
          ariaLabel={t("delayScheduledDate")}
          onChange={(next) => setScheduledInput(next ?? "", time)}
        />
        <TimePicker
          value={time}
          ariaLabel={t("delayScheduledTime")}
          onChange={(next) => setScheduledInput(date, next)}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("delayScheduledZone", { zone: timeZone })}</p>
    </div>
  );
}

export function DelayScheduleFields(props: Props) {
  const { node, editable, onChange, validation } = props;
  const t = useAppTranslations("workflows");
  const { locale } = useLocalePreferences();
  const format = useFormatters();
  const scheduled = node.config.delayType === "SCHEDULED_DATE";
  const duration = node.config.duration;
  const units =
    duration !== null && typeof duration === "object" && !Array.isArray(duration) ? duration : {};
  const globalIssue = validation.issues.find(
    (issue) => issue.path.length === 0 || (issue.path.length === 1 && issue.path[0] === "duration"),
  );
  function replace(config: WorkflowNode["config"]) {
    if (editable) onChange({ ...node, config });
  }
  function setDate(binding: DraftBinding) {
    replace({ delayType: "SCHEDULED_DATE", scheduledDateTime: { ...binding } });
  }
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium" aria-hidden="true">
        {t("delayResumeMode")}
      </p>
      <Select
        ariaLabel={t("delayResumeMode")}
        value={scheduled ? "SCHEDULED_DATE" : "DURATION"}
        disabled={!editable}
        options={[
          { value: "SCHEDULED_DATE", label: t("delayAtDateTime") },
          { value: "DURATION", label: t("delayAfterDuration") },
        ]}
        onChange={(mode) => {
          if (mode === "SCHEDULED_DATE" && !scheduled)
            setDate(typedLiteralFromInput("instant", ""));
          if (mode === "DURATION" && scheduled) replace({ delayType: "DURATION", duration: {} });
        }}
      />
      {scheduled ? (
        <DelayScheduleField
          {...props}
          key="date"
          label={t("delayScheduledDateTime")}
          path={["scheduledDateTime"]}
          raw={node.config.scheduledDateTime}
          onClear={() => setDate(typedLiteralFromInput("instant", ""))}
        >
          {() => (
            <DateTimeFields
              raw={node.config.scheduledDateTime}
              editable={editable}
              onChange={setDate}
            />
          )}
        </DelayScheduleField>
      ) : (
        delayDurationUnits.map((unit) => {
          const label = t(`delayUnits.${unit}`);
          const literal = literalValue(units[unit]);
          const shown =
            typeof literal === "number"
              ? format.number(literal, { useGrouping: false, maximumSignificantDigits: 21 })
              : typeof literal === "string"
                ? literal
                : "";
          function setAmount(raw: string) {
            const next = { ...units };
            if (raw === "") delete next[unit];
            else next[unit] = { ...numericLiteralFromInput(raw, locale) };
            replace({ delayType: "DURATION", duration: next });
          }
          return (
            <DelayScheduleField
              {...props}
              key={unit}
              label={label}
              path={["duration", unit]}
              raw={units[unit]}
              onClear={() => setAmount("")}
            >
              {(errorId) => (
                <Input
                  aria-label={label}
                  aria-invalid={errorId !== undefined}
                  aria-describedby={errorId}
                  inputMode="decimal"
                  dir="ltr"
                  placeholder={format.number(0)}
                  value={shown}
                  disabled={!editable}
                  maxLength={120}
                  onChange={(event) => setAmount(event.currentTarget.value)}
                />
              )}
            </DelayScheduleField>
          );
        })
      )}
      <p className="text-xs leading-5 text-muted-foreground">{t("delayScheduleBound")}</p>
      {globalIssue !== undefined && (
        <p className="text-xs text-destructive">{t(configurationIssueKeys[globalIssue.code])}</p>
      )}
    </div>
  );
}
