"use client";
import { formatTimeInput } from "@/components/ui/timeFormat";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { ReminderSelection } from "./reminderPolicy";

export function useCalendarReminderSummary(
  selection: ReminderSelection,
  allDay: boolean,
  valid: boolean,
): string {
  const t = useAppTranslations("calendar");
  const preferences = useLocalePreferences();
  if (!valid) return t("reminders.needsReview");
  if (selection.useDefault) return t("reminders.calendarDefaults");
  const rules = allDay ? selection.allDay : selection.timed;
  const first = rules[0];
  if (first === undefined) return t("reminders.none");
  if (rules.length > 1) return t("reminders.count", { count: rules.length });
  const method = t(first.method === "email" ? "reminders.email" : "reminders.notification");
  return "minutesBefore" in first
    ? t("reminders.timedSummary", { method, minutes: first.minutesBefore })
    : t("reminders.allDaySummary", {
        method,
        days: first.daysBefore,
        time: formatTimeInput(first.time, preferences.locale, preferences.numberingSystem),
      });
}
