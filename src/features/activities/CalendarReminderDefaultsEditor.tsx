"use client";
import { useEffect, useState } from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import {
  CalendarReminderDisclosure,
  CalendarReminderEmailHint,
} from "./CalendarReminderDisclosure";
import type { CalendarReminderEditorProps } from "./CalendarReminderEditor";
import { CalendarReminderRules } from "./CalendarReminderRules";
import type { ReminderDefaults } from "./reminderPolicy";
export type CalendarReminderDefaultsEditorProps = Omit<
  CalendarReminderEditorProps,
  "value" | "defaults" | "allDay" | "onChange"
> & { value: ReminderDefaults; onChange: (value: ReminderDefaults) => void };
export function CalendarReminderDefaultsEditor(
  props: CalendarReminderDefaultsEditorProps,
): React.ReactNode {
  const t = useAppTranslations("calendar");
  const [raw, setRaw] = useState({ timed: false, allDay: false });
  const [validity, setValidity] = useState({ timed: true, allDay: true });
  const rawDirty = raw.timed || raw.allDay;
  const valid = validity.timed && validity.allDay;
  const { onRawChange, onValidityChange } = props;
  useEffect(() => {
    onRawChange?.(rawDirty);
  }, [onRawChange, rawDirty]);
  useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);
  function status(kind: "timed" | "allDay", value: boolean, channel: "raw" | "validity"): void {
    const setter = channel === "raw" ? setRaw : setValidity;
    setter((current) => (current[kind] === value ? current : { ...current, [kind]: value }));
  }
  return (
    <CalendarReminderDisclosure
      title={t("reminders.defaultsTitle")}
      summary={
        valid
          ? t("reminders.defaultsSummary", {
              timed: props.value.timed.length,
              allDay: props.value.allDay.length,
            })
          : t("reminders.needsReview")
      }
      disabled={props.disabled}
      reveal={props.reveal}
      error={props.error}
      emailUnavailable={
        props.emailCapability !== "available" &&
        [...props.value.timed, ...props.value.allDay].some((rule) => rule.method === "email")
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">{t("reminders.defaultsHint")}</p>
      <CalendarReminderRules
        kind="timed"
        rules={props.value.timed}
        timeZone={props.timeZone}
        reveal={props.reveal === true || props.error != null}
        onChange={(timed) => props.onChange({ ...props.value, timed })}
        onRawChange={(value) => status("timed", value, "raw")}
        onValidityChange={(value) => status("timed", value, "validity")}
      />
      <CalendarReminderRules
        kind="allDay"
        defaultRules
        rules={props.value.allDay}
        timeZone={props.timeZone}
        reveal={props.reveal === true || props.error != null}
        onChange={(allDay) => props.onChange({ ...props.value, allDay })}
        onRawChange={(value) => status("allDay", value, "raw")}
        onValidityChange={(value) => status("allDay", value, "validity")}
      />
      <CalendarReminderEmailHint capability={props.emailCapability} />
    </CalendarReminderDisclosure>
  );
}
