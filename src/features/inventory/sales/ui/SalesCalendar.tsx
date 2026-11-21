"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import {
  addCalendarMonths,
  calendarWeekdayLabels,
  formatCalendarDate,
  isSameCalendarMonth,
  startOfCalendarMonth,
  startOfCalendarWeek,
} from "@/features/activities/calendarSystem";
import { addDaysUtc } from "@/features/activities/monthGrid";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useHydrated } from "@/lib/useHydrated";
import { cn } from "@/lib/utils";
import type { SalesOrderSummary } from "../contracts";
import type { SalesMessages } from "./messages";
import { isOverdue } from "./types";

const daysPerWeek = 7;
const weeksPerPage = 6;
const fallbackDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function civilDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function CalendarOrder({
  order,
  href,
  selected,
  today,
  t,
}: {
  order: SalesOrderSummary;
  href: string;
  selected: boolean;
  today: string;
  t: SalesMessages;
}) {
  const overdue = isOverdue(order, today);
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        aria-current={selected ? "page" : undefined}
        data-sales-calendar-order-id={order.id}
        className={cn(
          "block rounded border bg-background px-1.5 py-1 text-xs hover:text-primary aria-[current=page]:border-primary",
          overdue && "border-destructive/50",
        )}
      >
        <bdi className="block break-words font-medium">{order.reference}</bdi>
        {overdue && <span className="text-destructive">{t.overdue}</span>}
      </Link>
    </li>
  );
}

export function SalesCalendar({
  orders,
  anchorDay,
  today,
  selectedId,
  changeDay,
  orderHref,
  busy,
  t,
}: {
  orders: SalesOrderSummary[];
  anchorDay: string;
  today: string;
  selectedId: string | undefined;
  changeDay: (day: string) => void;
  orderHref: (orderId: string) => string;
  busy: boolean;
  t: SalesMessages;
}) {
  const locale = useLocalePreferences();
  const hydrated = useHydrated();
  const options = hydrated ? locale : {};
  const anchor = new Date(`${anchorDay}T00:00:00Z`);
  const monthStart = startOfCalendarMonth(anchor, options);
  const start = startOfCalendarWeek(monthStart, options);
  const title = hydrated
    ? formatCalendarDate(monthStart, options, { year: "numeric", month: "long" })
    : anchorDay.slice(0, 7);
  const weekdays = hydrated ? calendarWeekdayLabels(options) : fallbackDays;
  const buckets = new Map<string, SalesOrderSummary[]>();
  const unscheduled = [];
  for (const order of orders) {
    if (order.dueDate === null) {
      unscheduled.push(order);
    } else {
      const existing = buckets.get(order.dueDate) ?? [];
      existing.push(order);
      buckets.set(order.dueDate, existing);
    }
  }

  function move(delta: 1 | -1) {
    changeDay(civilDay(addCalendarMonths(monthStart, delta, options)));
  }

  return (
    <div className="min-w-0" data-sales-calendar>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex gap-1">
          <Button
            type="button"
            size="icon"
            className="size-8"
            variant="outline"
            aria-label={t.previousMonth}
            disabled={busy}
            onClick={() => move(-1)}
          >
            <ChevronLeft aria-hidden="true" className="rtl:rotate-180" />
          </Button>
          <Button
            type="button"
            size="icon"
            className="size-8"
            variant="outline"
            aria-label={t.nextMonth}
            disabled={busy}
            onClick={() => move(1)}
          >
            <ChevronRight aria-hidden="true" className="rtl:rotate-180" />
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table aria-label={t.calendar} className="w-full min-w-[38rem] table-fixed">
          <thead className="bg-muted/25 text-xs text-muted-foreground">
            <tr>
              {weekdays.map((weekday) => (
                <th key={weekday} scope="col" className="px-2 py-2 text-start font-medium">
                  {weekday}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: weeksPerPage }, (_, index) => {
              const week = addDaysUtc(start, index * daysPerWeek);
              return (
                <tr key={civilDay(week)}>
                  {Array.from({ length: daysPerWeek }, (_, offset) => {
                    const day = addDaysUtc(week, offset);
                    const dayKey = civilDay(day);
                    const isToday = dayKey === today;
                    const ordersForDay = buckets.get(dayKey) ?? [];
                    return (
                      <td
                        key={dayKey}
                        data-sales-date={dayKey}
                        className={cn(
                          "h-20 border-t border-e p-1.5 align-top last:border-e-0",
                          !isSameCalendarMonth(day, anchor, options) &&
                            "bg-muted/35 text-muted-foreground",
                        )}
                      >
                        <time
                          dateTime={dayKey}
                          aria-current={isToday ? "date" : undefined}
                          className={cn(
                            "mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs",
                            isToday && "bg-primary font-medium text-primary-foreground",
                          )}
                        >
                          {hydrated
                            ? formatCalendarDate(day, options, { day: "numeric" })
                            : day.getUTCDate()}
                        </time>
                        {ordersForDay.length > 0 && (
                          <ul className="space-y-1">
                            {ordersForDay.map((order) => (
                              <CalendarOrder
                                key={order.id}
                                href={orderHref(order.id)}
                                selected={order.id === selectedId}
                                {...{ order, today, t }}
                              />
                            ))}
                          </ul>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {unscheduled.length > 0 && (
        <div className="border-t px-3 py-2.5">
          <h3 className="mb-2 text-sm font-semibold">{t.unscheduled}</h3>
          <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {unscheduled.map((order) => (
              <CalendarOrder
                key={order.id}
                href={orderHref(order.id)}
                selected={order.id === selectedId}
                {...{ order, today, t }}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
