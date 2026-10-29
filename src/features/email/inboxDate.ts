import {
  type FormattingPreferences,
  formatDateTime,
  localeTagForFormatting,
} from "@/lib/localeFormatting";
import { emailMessagesForLocale } from "./emailMessages";

type MailPreferences = Pick<
  FormattingPreferences,
  "locale" | "calendar" | "timeZone" | "numberingSystem"
>;
function preferencesOrLocal(preferences?: MailPreferences): MailPreferences {
  return (
    preferences ?? {
      locale: "en",
      calendar: "gregory",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
  );
}
function validDate(iso: string | null): Date | null {
  if (iso === null || iso === "") return null;
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? null : value;
}
function year(date: Date, preferences: MailPreferences): string {
  return new Intl.DateTimeFormat(localeTagForFormatting(preferences), {
    calendar: preferences.calendar,
    timeZone: preferences.timeZone,
    year: "numeric",
  }).format(date);
}
function dayNumber(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000;
}
export function formatInboxListDate(
  iso: string | null,
  now: Date = new Date(),
  preferences?: MailPreferences,
): string {
  const date = validDate(iso);
  if (date === null) return "";
  const prefs = preferencesOrLocal(preferences);
  const sameYear = year(date, prefs) === year(now, prefs);
  return formatDateTime(date, prefs, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
export function formatReaderDate(
  iso: string | null,
  now: Date = new Date(),
  preferences?: MailPreferences,
): string {
  const date = validDate(iso);
  if (date === null) return "";
  const prefs = preferencesOrLocal(preferences);
  const sameYear = year(date, prefs) === year(now, prefs);
  const datePart = formatDateTime(date, prefs, {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const age = Math.round(dayNumber(now, prefs.timeZone) - dayNumber(date, prefs.timeZone));
  const copy = emailMessagesForLocale(
    prefs.locale === "fa" ? "fa" : "en",
    prefs.numberingSystem,
  )._relative;
  const relative = age <= 0 ? copy.today : age === 1 ? copy.yesterday : copy.daysAgo(age);
  return `${datePart} (${relative})`;
}
export function formatTimelineEmailDate(
  iso: string | null,
  now: Date = new Date(),
  preferences?: MailPreferences,
): string {
  const date = validDate(iso);
  if (date === null) return "";
  const prefs = preferencesOrLocal(preferences);
  const time = formatDateTime(date, prefs, { hour: "numeric", minute: "2-digit" });
  const copy = emailMessagesForLocale(
    prefs.locale === "fa" ? "fa" : "en",
    prefs.numberingSystem,
  )._relative;
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  let relative: string;
  if (minutes < 1) relative = copy.justNow;
  else if (minutes === 1) relative = copy.minuteAgo;
  else if (minutes < 60) relative = copy.minutesAgo(minutes);
  else {
    const hours = Math.round(minutes / 60);
    relative = hours < 24 ? copy.hoursAgo(hours) : copy.longDaysAgo(Math.round(hours / 24));
  }
  return `${time} (${relative})`;
}
