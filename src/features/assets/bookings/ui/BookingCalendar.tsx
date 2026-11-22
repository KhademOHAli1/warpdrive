"use client";

import { Temporal } from "@js-temporal/polyfill";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { calendarWeekdayLabels, formatCalendarDate } from "@/features/activities/calendarSystem";
import {
  anchorDate,
  monthTitle,
  selectWindow,
  stepAnchorIso,
} from "@/features/activities/calendarView";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateTime } from "@/lib/localeFormatting";
import { useHydrated } from "@/lib/useHydrated";
import { addCivilDays, civilDateRange, instantCivilDate } from "@/lib/zonedDateTime";
import type { BookingCalendarEntry, BookingSite } from "../contracts";
import type { BookingWords } from "./messages";

function overlaps(entry: BookingCalendarEntry, start: string, end: string) {
  return entry.window.startAt < end && entry.window.endAt > start;
}

function dayEntries(entries: BookingCalendarEntry[], day: string, timeZone: string) {
  const range = civilDateRange(day, addCivilDays(day, 1), timeZone);
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  return entries.filter((entry) => overlaps(entry, from, to));
}

function calendarHours(site: BookingSite, day: string) {
  const rules = site.policy.workingHours;
  const exception = rules.overrides.find(({ date }) => date === day);
  if (exception !== undefined) return exception.hours;
  const weekday = Temporal.PlainDate.from(day).dayOfWeek;
  return rules.weekly.find((day) => day.weekday === weekday)?.hours ?? null;
}

function CalendarDay({
  date,
  entries,
  timeZone,
  active,
  jump,
}: {
  date: Date;
  entries: BookingCalendarEntry[];
  timeZone: string;
  active: boolean;
  jump: (day: string) => void;
}) {
  const options = useLocalePreferences();
  const day = date.toISOString().slice(0, 10);
  const occupied = dayEntries(entries, day, timeZone).length;
  return (
    <td className="p-0.5">
      <button
        type="button"
        aria-pressed={active}
        aria-label={formatCalendarDate(date, options, { dateStyle: "full" })}
        data-booking-calendar-day={day}
        data-booking-day-count={occupied}
        className="flex min-h-12 w-full flex-col items-center justify-center rounded-md border px-1 py-1 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-accent"
        onClick={() => jump(day)}
      >
        {formatCalendarDate(date, options, { day: "numeric" })}
        {occupied > 0 && (
          <Badge variant="outline" className="mt-0.5 min-w-5 px-1 text-[0.65rem]">
            {occupied}
          </Badge>
        )}
      </button>
    </td>
  );
}

export function BookingCalendar({
  site,
  entries,
  onOpenBooking,
  words: t,
}: {
  site: BookingSite;
  entries: BookingCalendarEntry[];
  onOpenBooking: (id: string) => void;
  words: BookingWords;
}) {
  const preferences = useLocalePreferences();
  const hydrated = useHydrated();
  const zone = site.policy.timeZone;
  const options = { ...preferences, timeZone: zone };
  const [selected, setSelected] = useState(() => instantCivilDate(new Date(), zone));
  const [anchor, setAnchor] = useState(selected);
  if (!hydrated) return null;

  const { days } = selectWindow("month", anchor, options);
  const current = dayEntries(entries, selected, zone);
  const hours = calendarHours(site, selected);
  const weekdays = calendarWeekdayLabels(options);

  function showToday() {
    const today = instantCivilDate(new Date(), zone);
    setSelected(today);
    setAnchor(today);
  }

  function step(direction: 1 | -1) {
    const next = stepAnchorIso("month", anchor, direction, options);
    setAnchor(next);
    setSelected(next);
  }

  return (
    <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(17rem,2fr)]">
      <section aria-label={t.calendar} className="min-w-0 space-y-3 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{monthTitle(anchor, options)}</h2>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" aria-label={t.previous} onClick={() => step(-1)}>
              <ChevronLeft aria-hidden="true" size={16} className="rtl:rotate-180" />
            </Button>
            <Button size="sm" variant="outline" onClick={showToday}>
              {t.today}
            </Button>
            <Button size="sm" variant="outline" aria-label={t.next} onClick={() => step(1)}>
              <ChevronRight aria-hidden="true" size={16} className="rtl:rotate-180" />
            </Button>
          </div>
        </div>
        <table aria-label={monthTitle(anchor, options)} className="w-full table-fixed">
          <thead>
            <tr>
              {weekdays.map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="truncate px-0.5 py-1 text-xs font-medium text-muted-foreground"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_, week) => {
              const row = days.slice(week * 7, week * 7 + 7);
              return (
                <tr key={row[0]?.toISOString() ?? week}>
                  {row.map((date) => (
                    <CalendarDay
                      key={date.toISOString()}
                      date={date}
                      entries={entries}
                      timeZone={zone}
                      active={date.toISOString().startsWith(selected)}
                      jump={setSelected}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section
        data-booking-calendar-selection={selected}
        className="space-y-2 rounded-lg border bg-card p-3"
      >
        <h2 className="text-sm font-semibold">
          {formatCalendarDate(anchorDate(selected), options, { dateStyle: "full" })}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t.zone} <bdi>{zone}</bdi>
        </p>
        {site.policy.workingHours.enabled && (
          <p className="text-xs text-muted-foreground">
            {t.workingHours}{" "}
            {hours === null ? (
              t.closed
            ) : (
              <bdi>
                {hours.opensAt} – {hours.closesAt}
              </bdi>
            )}
          </p>
        )}
        {current.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.emptyDay}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {current.map((entry) => (
              <li
                key={entry.id}
                data-booking-calendar-entry={entry.kind}
                className="space-y-1 p-2.5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  {entry.bookingId === null ? (
                    <p className="text-sm font-medium [overflow-wrap:anywhere]">
                      <bdi>
                        {entry.title ?? (entry.kind === "maintenance" ? t.maintenance : t.busy)}
                      </bdi>
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="rounded text-start text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]"
                      onClick={() => onOpenBooking(entry.bookingId ?? "")}
                    >
                      <bdi>{entry.title ?? t.busy}</bdi>
                    </button>
                  )}
                  <Badge variant="outline">{t[entry.kind]}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={entry.window.startAt}>
                    {formatDateTime(entry.window.startAt, options)}
                  </time>
                  {" – "}
                  <time dateTime={entry.window.endAt}>
                    {formatDateTime(entry.window.endAt, options)}
                  </time>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
