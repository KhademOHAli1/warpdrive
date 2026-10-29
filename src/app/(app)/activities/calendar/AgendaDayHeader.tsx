"use client";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { calendarDayHeading } from "./calendarLabels";

// One day's column header. Today is called out the way MonthView calls out its today cell, so a
// week opened on the current week says which column the viewer is standing in.
export function AgendaDayHeader({ iso, today }: { iso: string; today: boolean }): React.ReactNode {
  const preferences = useLocalePreferences();
  const t = useAppTranslations("calendar");
  const heading = calendarDayHeading(iso, preferences);
  return (
    <div
      data-today={today}
      className={cn(
        "border-s border-border px-2 py-1 text-xs font-medium tabular-nums",
        // bg-accent is a hair off white and read as no highlight at all; the link blue is the
        // colour this app already uses for "the one you are on".
        today ? "bg-link/10 font-semibold text-link" : "text-foreground",
      )}
    >
      {heading}
      {today && <span className="sr-only">{t("todayLabel", { date: "" })}</span>}
    </div>
  );
}
