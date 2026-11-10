"use client";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { isValidHm } from "@/components/ui/timeFormat";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { ReminderInputStatus } from "./CalendarReminderNumber";
import { CalendarReminderRuleRow } from "./CalendarReminderRuleRow";
import {
  type AllDayReminderRule,
  REMINDER_MAX_ROWS,
  type TimedReminderRule,
} from "./reminderPolicy";

type Props = {
  timeZone: string;
  defaultRules?: boolean;
  reveal?: boolean;
  onRawChange?: (dirty: boolean) => void;
  onValidityChange?: (valid: boolean) => void;
} & (
  | { kind: "timed"; rules: TimedReminderRule[]; onChange: (rules: TimedReminderRule[]) => void }
  | { kind: "allDay"; rules: AllDayReminderRule[]; onChange: (rules: AllDayReminderRule[]) => void }
);
const TIMED_STARTERS = [10, 30, 60, 120, 1440, 0];
const ALL_DAY_STARTERS = [0, 1, 2, 3, 7, 14];
export function CalendarReminderRules(props: Props): React.ReactNode {
  const t = useAppTranslations("calendar");
  const [keys, setKeys] = useState(() => props.rules.map((_, index) => index));
  const [statuses, setStatuses] = useState<Record<number, Record<string, ReminderInputStatus>>>({});
  if (keys.length !== props.rules.length)
    setKeys(props.rules.map((_, index) => keys[index] ?? Math.max(-1, ...keys) + index + 1));
  const active = keys.flatMap((key) => Object.values(statuses[key] ?? {}));
  const duplicate =
    new Set(props.rules.map((rule) => JSON.stringify(rule))).size !== props.rules.length;
  const clocksValid = props.kind === "timed" || props.rules.every((rule) => isValidHm(rule.time));
  const dirty = active.some((state) => state.dirty);
  const valid = !duplicate && clocksValid && active.every((state) => state.valid);
  const { onRawChange, onValidityChange } = props;
  useEffect(() => {
    onRawChange?.(dirty);
  }, [onRawChange, dirty]);
  useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);
  function status(key: number, field: string, next: ReminderInputStatus): void {
    setStatuses((current) => {
      const previous = current[key]?.[field];
      if (previous?.dirty === next.dirty && previous.valid === next.valid) return current;
      return { ...current, [key]: { ...current[key], [field]: next } };
    });
  }
  function remove(index: number): void {
    setKeys((current) => current.filter((_, at) => at !== index));
    if (props.kind === "timed") props.onChange(props.rules.filter((_, at) => at !== index));
    else props.onChange(props.rules.filter((_, at) => at !== index));
  }
  function add(): void {
    if (props.rules.length >= REMINDER_MAX_ROWS) return;
    setKeys((current) => [...current, Math.max(-1, ...current) + 1]);
    if (props.kind === "timed") {
      const minutesBefore =
        TIMED_STARTERS.find(
          (minutes) =>
            !props.rules.some(
              (rule) => rule.method === "notification" && rule.minutesBefore === minutes,
            ),
        ) ?? 0;
      props.onChange([...props.rules, { method: "notification", minutesBefore }]);
    } else {
      const daysBefore =
        ALL_DAY_STARTERS.find(
          (days) =>
            !props.rules.some(
              (rule) =>
                rule.method === "notification" && rule.daysBefore === days && rule.time === "09:00",
            ),
        ) ?? 0;
      props.onChange([...props.rules, { method: "notification", daysBefore, time: "09:00" }]);
    }
  }
  return (
    <fieldset
      aria-label={t(props.kind === "timed" ? "reminders.timed" : "reminders.allDay")}
      className="min-w-0 space-y-2"
    >
      <legend className="pb-2 text-xs font-medium text-muted-foreground">
        {t(props.kind === "timed" ? "reminders.timed" : "reminders.allDay")}
      </legend>
      {props.kind === "allDay" && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {props.defaultRules === true ? (
            t("reminders.allDayDefaultsHint")
          ) : (
            <>
              {t("reminders.allDayHint")} <bdi dir="ltr">{props.timeZone}</bdi>
            </>
          )}
        </p>
      )}
      <ul className="space-y-2">
        {props.kind === "timed"
          ? props.rules.map((rule, index) => (
              <CalendarReminderRuleRow
                key={keys[index]}
                kind="timed"
                index={index}
                rule={rule}
                reveal={props.reveal}
                onRemove={() => remove(index)}
                onStatus={(field, next) => status(keys[index] ?? index, field, next)}
                onChange={(next) =>
                  props.onChange(props.rules.map((current, at) => (at === index ? next : current)))
                }
              />
            ))
          : props.rules.map((rule, index) => (
              <CalendarReminderRuleRow
                key={keys[index]}
                kind="allDay"
                index={index}
                rule={rule}
                reveal={props.reveal}
                onRemove={() => remove(index)}
                onStatus={(field, next) => status(keys[index] ?? index, field, next)}
                onChange={(next) =>
                  props.onChange(props.rules.map((current, at) => (at === index ? next : current)))
                }
              />
            ))}
      </ul>
      {duplicate && (
        <p role="alert" className="text-xs text-destructive">
          {t("reminders.duplicate")}
        </p>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={props.rules.length >= REMINDER_MAX_ROWS}
        onClick={add}
        className="text-muted-foreground"
      >
        <Plus className="size-3.5" aria-hidden />
        {t("reminders.add")}
      </Button>
      {props.rules.length >= REMINDER_MAX_ROWS && (
        <p className="text-xs text-muted-foreground">
          {t("reminders.limit", { count: REMINDER_MAX_ROWS })}
        </p>
      )}
    </fieldset>
  );
}
