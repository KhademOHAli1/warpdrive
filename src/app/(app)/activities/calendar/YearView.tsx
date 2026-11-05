"use client";

import Link from "next/link";
import type { CalendarActivity } from "@/features/activities/calendar";
import {
  calendarWeekdayLabels,
  calendarYearMonths,
  formatCalendarDate,
  isSameCalendarMonth,
} from "@/features/activities/calendarSystem";
import {
  anchorDate,
  calendarHref,
  monthTitle,
  selectWindow,
} from "@/features/activities/calendarView";
import { groupMonthActivities } from "@/features/activities/monthGrid";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { calendarDayLabel } from "./calendarLabels";

const WEEK_ROWS = [0, 1, 2, 3, 4, 5] as const;

export function YearView({
  anchorIso,
  activities,
  todayIso,
}: {
  anchorIso: string;
  activities: CalendarActivity[];
  todayIso: string;
}): React.ReactNode {
  const preferences = useLocalePreferences();
  const t = useAppTranslations("calendar");
  const months = calendarYearMonths(anchorDate(anchorIso), preferences);
  const yearDays = selectWindow("year", anchorIso, preferences).days;
  const grouped = groupMonthActivities(activities, yearDays, preferences.timeZone);
  const weekdays = calendarWeekdayLabels(preferences);

  return (
    <section
      aria-label={t("year")}
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
    >
      {months.map((month) => {
        const monthIso = month.toISOString().slice(0, 10);
        const title = monthTitle(monthIso, preferences);
        const days = selectWindow("month", monthIso, preferences).days;
        return (
          <section
            key={monthIso}
            aria-label={title}
            className="rounded-lg border border-border bg-card p-3"
          >
            <h3 className="mb-3 text-sm font-medium text-foreground">
              <Link href={calendarHref("month", monthIso)} className="hover:underline">
                {title}
              </Link>
            </h3>
            <table
              aria-label={title}
              className="w-full table-fixed border-collapse text-center text-xs"
            >
              <thead>
                <tr>
                  {weekdays.map((weekday) => (
                    <th
                      key={weekday}
                      scope="col"
                      className="pb-2 font-medium text-muted-foreground"
                    >
                      {weekday}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {WEEK_ROWS.map((week) => (
                  <tr key={week}>
                    {days.slice(week * 7, week * 7 + 7).map((day) => {
                      const iso = day.toISOString().slice(0, 10);
                      if (!isSameCalendarMonth(day, month, preferences)) return <td key={iso} />;
                      const count = grouped.get(iso)?.length ?? 0;
                      const label = calendarDayLabel(iso, preferences);
                      const today = iso === todayIso;
                      return (
                        <td key={iso} className="p-0.5">
                          <Link
                            href={calendarHref("day", iso)}
                            aria-current={today ? "date" : undefined}
                            aria-label={
                              count > 0 ? t("dayActivityCount", { date: label, count }) : label
                            }
                            className={`relative flex min-h-8 items-center justify-center rounded-md tabular-nums hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${today ? "bg-primary text-primary-foreground" : "text-foreground"}`}
                          >
                            {formatCalendarDate(day, preferences, { day: "numeric" })}
                            {count > 0 && (
                              <span
                                aria-hidden
                                className={`absolute bottom-0.5 size-1 rounded-full ${today ? "bg-primary-foreground" : "bg-primary"}`}
                              />
                            )}
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </section>
  );
}
