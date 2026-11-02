"use client";
import { useEffect, useState } from "react";
import { ToggleField } from "@/components/ui/ToggleField";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import {
  CalendarReminderDisclosure,
  CalendarReminderEmailHint,
} from "./CalendarReminderDisclosure";
import { CalendarReminderRules } from "./CalendarReminderRules";
import { useCalendarReminderSummary } from "./CalendarReminderSummary";
import type { ReminderDefaults, ReminderSelection } from "./reminderPolicy";
export type ReminderEmailCapability = "available" | "mailboxMissing" | "channelDisabled";
export interface CalendarReminderEditorProps {
  value: ReminderSelection;
  defaults: ReminderDefaults;
  allDay: boolean;
  timeZone: string;
  emailCapability: ReminderEmailCapability;
  onChange: (selection: ReminderSelection) => void;
  disabled?: boolean;
  reveal?: boolean;
  error?: string | null;
  onRawChange?: (dirty: boolean) => void;
  onValidityChange?: (valid: boolean) => void;
}
export function CalendarReminderEditor(props: CalendarReminderEditorProps): React.ReactNode {
  const t = useAppTranslations("calendar");
  const [cached, setCached] = useState<ReminderDefaults>(() =>
    props.value.useDefault
      ? props.defaults
      : { timed: props.value.timed, allDay: props.value.allDay },
  );
  const [hasCustom, setHasCustom] = useState(!props.value.useDefault);
  const [raw, setRaw] = useState({ timed: false, allDay: false });
  const [validity, setValidity] = useState({ timed: true, allDay: true });
  const custom = props.value.useDefault ? (hasCustom ? cached : props.defaults) : props.value;
  const active = props.value.useDefault ? props.defaults : props.value;
  const rules = props.allDay ? active.allDay : active.timed;
  const valid = props.value.useDefault || (validity.timed && validity.allDay);
  const review = props.reveal === true || props.error != null;
  const timedHidden = props.allDay && !review;
  const allDayHidden = !props.allDay && !review;
  const rawDirty = !props.value.useDefault && (raw.timed || raw.allDay);
  const summary = useCalendarReminderSummary(props.value, props.allDay, valid);
  const { onRawChange, onValidityChange } = props;
  useEffect(() => {
    onRawChange?.(rawDirty);
  }, [onRawChange, rawDirty]);
  useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);
  function change(next: ReminderDefaults): void {
    setHasCustom(true);
    setCached(next);
    props.onChange({ useDefault: false, ...next });
  }
  function status(kind: "timed" | "allDay", value: boolean, channel: "raw" | "validity"): void {
    const setter = channel === "raw" ? setRaw : setValidity;
    setter((current) => (current[kind] === value ? current : { ...current, [kind]: value }));
  }
  return (
    <CalendarReminderDisclosure
      title={t("reminders.title")}
      summary={summary}
      disabled={props.disabled}
      reveal={props.reveal}
      error={props.error}
      emailUnavailable={
        props.emailCapability !== "available" && rules.some((rule) => rule.method === "email")
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">{t("reminders.personalHint")}</p>
      <ToggleField
        label={t("reminders.useDefault")}
        checked={props.value.useDefault}
        onCheckedChange={(useDefault) => {
          if (useDefault) {
            setHasCustom(true);
            setCached(custom);
            props.onChange({ useDefault: true });
          } else change(custom);
        }}
      />
      <div hidden={props.value.useDefault}>
        <fieldset disabled={props.value.useDefault}>
          <div hidden={timedHidden}>
            <fieldset disabled={timedHidden}>
              <CalendarReminderRules
                kind="timed"
                rules={custom.timed}
                timeZone={props.timeZone}
                reveal={review}
                onChange={(timed) => change({ ...custom, timed })}
                onRawChange={(value) => status("timed", value, "raw")}
                onValidityChange={(value) => status("timed", value, "validity")}
              />
            </fieldset>
          </div>
          <div hidden={allDayHidden}>
            <fieldset disabled={allDayHidden}>
              <CalendarReminderRules
                kind="allDay"
                rules={custom.allDay}
                timeZone={props.timeZone}
                reveal={review}
                onChange={(allDay) => change({ ...custom, allDay })}
                onRawChange={(value) => status("allDay", value, "raw")}
                onValidityChange={(value) => status("allDay", value, "validity")}
              />
            </fieldset>
          </div>
        </fieldset>
      </div>
      <CalendarReminderEmailHint capability={props.emailCapability} />
    </CalendarReminderDisclosure>
  );
}
