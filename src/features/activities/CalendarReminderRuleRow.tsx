"use client";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { TimePicker } from "@/components/ui/TimePicker";
import { isValidHm, maskTime } from "@/components/ui/timeFormat";
import { Tip } from "@/components/ui/tooltip";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { CalendarReminderNumber, type ReminderInputStatus } from "./CalendarReminderNumber";
import {
  type AllDayReminderRule,
  REMINDER_MAX_DAYS,
  REMINDER_MAX_MINUTES,
  type TimedReminderRule,
} from "./reminderPolicy";

type Props = {
  index: number;
  reveal?: boolean;
  onRemove: () => void;
  onStatus: (field: string, status: ReminderInputStatus) => void;
} & (
  | { kind: "timed"; rule: TimedReminderRule; onChange: (rule: TimedReminderRule) => void }
  | { kind: "allDay"; rule: AllDayReminderRule; onChange: (rule: AllDayReminderRule) => void }
);
export function CalendarReminderRuleRow(props: Props): React.ReactNode {
  const t = useAppTranslations("calendar");
  const index = props.index + 1;
  function method(value: string): void {
    if (value !== "notification" && value !== "email") return;
    if (props.kind === "timed") props.onChange({ ...props.rule, method: value });
    else props.onChange({ ...props.rule, method: value });
  }
  return (
    <li className="space-y-2 rounded-md border border-border/60 bg-muted/15 p-2.5">
      <div className="flex items-center gap-2">
        <Select
          ariaLabel={t("reminders.method", { index })}
          value={props.rule.method}
          onChange={method}
          options={[
            { value: "notification", label: t("reminders.notification") },
            { value: "email", label: t("reminders.email") },
          ]}
          triggerClassName="min-w-0 flex-1"
        />
        <Tip label={t("reminders.remove", { index })}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("reminders.remove", { index })}
            onClick={props.onRemove}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </Tip>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        {props.kind === "timed" ? (
          <CalendarReminderNumber
            value={props.rule.minutesBefore}
            max={REMINDER_MAX_MINUTES}
            label={t("reminders.minutes", { index })}
            caption={t("reminders.minutesLabel")}
            reveal={props.reveal}
            onChange={(minutesBefore) => props.onChange({ ...props.rule, minutesBefore })}
            onStatus={(status) => props.onStatus("number", status)}
          />
        ) : (
          <>
            <CalendarReminderNumber
              value={props.rule.daysBefore}
              max={REMINDER_MAX_DAYS}
              label={t("reminders.days", { index })}
              caption={t("reminders.daysLabel")}
              reveal={props.reveal}
              onChange={(daysBefore) => props.onChange({ ...props.rule, daysBefore })}
              onStatus={(status) => props.onStatus("number", status)}
            />
            <div
              className="space-y-1"
              data-reminder-input=""
              onChangeCapture={(event) => {
                if (!(event.target instanceof HTMLInputElement)) return;
                const clock = maskTime(event.target.value);
                props.onStatus("clock", {
                  valid: isValidHm(clock),
                  dirty: clock !== props.rule.time || !isValidHm(clock),
                });
              }}
            >
              <p className="text-xs text-muted-foreground">{t("reminders.timeLabel")}</p>
              <TimePicker
                value={props.rule.time}
                required
                ariaLabel={t("reminders.time", { index })}
                onChange={(time) => {
                  props.onStatus("clock", { valid: isValidHm(time), dirty: false });
                  props.onChange({ ...props.rule, time });
                }}
              />
            </div>
          </>
        )}
      </div>
    </li>
  );
}
