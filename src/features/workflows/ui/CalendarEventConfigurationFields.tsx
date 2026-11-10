"use client";

import { useId, useMemo } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { TimePicker } from "@/components/ui/TimePicker";
import { ToggleField } from "@/components/ui/ToggleField";
import { activityReminderTimeZone } from "@/features/activities/reminderIntentTypes";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { regionalTimeZones } from "@/features/i18n/regionalContext";
import { formatDateOnly, formatDateTime } from "@/lib/localeFormatting";
import { instantParts, wallTimeToInstant } from "@/lib/zonedDateTime";
import type { ConfigurationValidation } from "../configurationTypes";
import { isMappingDate, isMappingInstant, typedLiteralFromInput } from "../mappingLiteralIntent";
import {
  type DraftBinding,
  draftBindingSchema,
  type WorkflowDefinition,
  type WorkflowNode,
} from "../schemas";
import {
  type WorkflowCalendarEventField,
  workflowCalendarEventFields,
  workflowCalendarEventFieldTarget,
} from "../workflowCalendarEventContract";
import { BindingField } from "./BindingField";
import { configurationIssueKeys } from "./configurationIssueMessage";
import styles from "./workflowInspector.module.css";

const copy = {
  en: {
    local:
      "Creates an event in Warpdrive Calendar. This step sends no invitations and sets no reminders.",
    inclusive: "The end date is included.",
  },
  de: {
    local:
      "Erstellt einen Termin im Warpdrive-Kalender. Dieser Schritt sendet keine Einladungen und richtet keine Erinnerungen ein.",
    inclusive: "Das Enddatum ist eingeschlossen.",
  },
  fa: {
    local:
      "رویدادی در تقویم وارپ‌درایو ایجاد می‌کند. این مرحله دعوت‌نامه نمی‌فرستد و یادآوری تنظیم نمی‌کند.",
    inclusive: "تاریخ پایان نیز در بازهٔ رویداد قرار می‌گیرد.",
  },
} as const;

const fieldLabels = {
  title: "editor.eventTitle",
  description: "editor.description",
  location: "editor.location",
  startsAt: "editor.start",
  endsAt: "editor.end",
} as const;

interface Props {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  validation: ConfigurationValidation;
}

function literalText(raw: unknown): string | undefined {
  const parsed = draftBindingSchema.safeParse(raw);
  return parsed.success && parsed.data.kind === "value" && typeof parsed.data.value === "string"
    ? parsed.data.value
    : undefined;
}

function scheduleParts(value: string, timeZone: string) {
  if (isMappingInstant(value)) return instantParts(value, timeZone);
  const match = /^(\d{4}-\d{2}-\d{2})?(?:T(\d{2}:\d{2}))?$/.exec(value);
  return { date: match?.[1] ?? "", time: match?.[2] ?? "" };
}

function ScheduleValue({
  value,
  timeZone,
  allDay,
  start,
  editable,
  onChange,
}: {
  value: string;
  timeZone: string;
  allDay: boolean;
  start: boolean;
  editable: boolean;
  onChange: (binding: DraftBinding) => void;
}) {
  const calendar = useAppTranslations("calendar");
  const t = useAppTranslations("workflows");
  const preferences = useLocalePreferences();
  const { date, time } = scheduleParts(value, timeZone);
  const valid = allDay ? isMappingDate(value) : isMappingInstant(value);
  if (!editable)
    return (
      <p>
        {valid
          ? allDay
            ? formatDateOnly(value, preferences)
            : formatDateTime(value, { ...preferences, timeZone })
          : t("setupRequired")}
      </p>
    );

  function change(nextDate: string, nextTime: string) {
    if (allDay) {
      onChange(typedLiteralFromInput("date", nextDate));
      return;
    }
    let next = `${nextDate}${nextTime === "" ? "" : `T${nextTime}`}`;
    if (nextDate !== "" && nextTime !== "") {
      try {
        next = wallTimeToInstant(nextDate, nextTime, timeZone).iso;
      } catch {
        // Keep an invalid wall time visible and editable instead of shifting it.
      }
    }
    onChange(typedLiteralFromInput("instant", next));
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <DatePicker
          value={isMappingDate(date) ? date : null}
          ariaLabel={calendar(start ? "editor.startDate" : "editor.endDate")}
          onChange={(next) => change(next ?? "", time)}
        />
        {!allDay && (
          <TimePicker
            value={time}
            ariaLabel={calendar(start ? "editor.startTime" : "editor.endTime")}
            onChange={(next) => change(date, next)}
          />
        )}
      </div>
      {!allDay && !valid && date !== "" && time !== "" && (
        <p className="text-xs text-destructive" role="alert">
          {calendar("invalidWallTime")}
        </p>
      )}
    </div>
  );
}

function CalendarField({
  definition,
  node,
  editable,
  validation,
  field,
  allDay,
  timeZone,
  set,
}: Pick<Props, "definition" | "node" | "editable" | "validation"> & {
  field: WorkflowCalendarEventField;
  allDay: boolean;
  timeZone: string;
  set: (binding: DraftBinding) => void;
}) {
  const calendar = useAppTranslations("calendar");
  const t = useAppTranslations("workflows");
  const inputId = useId();
  const { key, maxLength } = field;
  const label = calendar(fieldLabels[key]);
  const value = node.config[key];
  const literal = literalText(value) ?? "";
  const schedule = key === "startsAt" || key === "endsAt";
  const issue = validation.issues.find(({ path }) => path.length === 1 && path[0] === key);
  const error = issue === undefined ? undefined : t(configurationIssueKeys[issue.code]);
  const control = (errorId: string) => {
    if (schedule)
      return (
        <ScheduleValue
          value={literal}
          timeZone={timeZone}
          allDay={allDay}
          start={key === "startsAt"}
          editable={editable}
          onChange={set}
        />
      );
    return (
      <div className={styles.field}>
        <label htmlFor={inputId}>{label}</label>
        <Textarea
          id={inputId}
          dir="auto"
          value={literal}
          disabled={!editable}
          maxLength={maxLength}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : errorId}
          onChange={(event) => set({ kind: "value", value: event.currentTarget.value })}
        />
      </div>
    );
  };
  const customControl = schedule || key === "description";
  return (
    <BindingField
      definition={definition}
      nodeId={node.id}
      value={value}
      label={label}
      sourceLabel={t("recordCreateFieldSource", { field: label })}
      editable={editable}
      path={[key]}
      target={workflowCalendarEventFieldTarget(node.id, key, allDay)}
      kind="text"
      onChange={set}
      allowLiteral={!customControl}
      literalControl={customControl ? control : undefined}
      literalControlLabel={t("literalValue")}
      maxLength={maxLength}
      error={error}
    />
  );
}

export function CalendarEventConfigurationFields(props: Props) {
  const { node, editable, onChange } = props;
  const { locale, timeZone: accountZone } = useLocalePreferences();
  const calendar = useAppTranslations("calendar");
  const preferences = useAppTranslations("preferences");
  const t = useAppTranslations("workflows");
  const configuredZone = activityReminderTimeZone.safeParse(node.config.timeZone);
  const zoneUnavailable = node.config.timeZone !== undefined && !configuredZone.success;
  const timeZone = configuredZone.success ? configuredZone.data : accountZone;
  const allDay = node.config.allDay === true;
  const zoneOptions = useMemo(
    () =>
      [...new Set([accountZone, timeZone, ...regionalTimeZones(undefined)])].map((zone) => ({
        value: zone,
        label: zone,
      })),
    [accountZone, timeZone],
  );

  function change(patch: WorkflowNode["config"]) {
    if (editable) onChange({ ...node, config: { allDay, timeZone, ...node.config, ...patch } });
  }
  function changeKind(next: boolean) {
    const patch: WorkflowNode["config"] = { allDay: next };
    for (const key of ["startsAt", "endsAt"] as const) {
      const value = literalText(node.config[key]);
      if (value !== undefined)
        patch[key] = {
          ...typedLiteralFromInput(next ? "date" : "instant", scheduleParts(value, timeZone).date),
        };
    }
    change(patch);
  }
  return (
    <div className="space-y-4">
      <p className={styles.hint}>{copy[locale].local}</p>
      <fieldset className={styles.field}>
        <legend className={styles.label}>{preferences("timeZone")}</legend>
        <Select
          ariaLabel={preferences("timeZone")}
          value={zoneUnavailable ? "" : timeZone}
          placeholder={t("unavailableValue")}
          options={zoneOptions}
          disabled={!editable}
          onChange={(next) => {
            if (activityReminderTimeZone.safeParse(next).success) change({ timeZone: next });
          }}
        />
        {zoneUnavailable && (
          <p className="text-xs text-destructive">{t("configurationOptionUnavailable")}</p>
        )}
      </fieldset>
      <ToggleField
        label={calendar("allDay")}
        checked={allDay}
        disabled={!editable}
        onCheckedChange={changeKind}
      />
      {workflowCalendarEventFields.map((field) => (
        <CalendarField
          key={field.key}
          {...props}
          field={field}
          allDay={allDay}
          timeZone={timeZone}
          set={(binding) => change({ [field.key]: { ...binding } })}
        />
      ))}
      {allDay && <p className={styles.hint}>{copy[locale].inclusive}</p>}
    </div>
  );
}
