"use client";
import type React from "react";
import { useMemo, useState } from "react";
import { type CalendarSystem, DatePicker } from "@/components/ui/DatePicker";
import type { DayAccessory } from "@/components/ui/DayAccessoryButton";
import { parseYmd } from "@/components/ui/dateFormat";
import type { ActivityLoadLevel } from "@/constants/activityLoad";
import { useLocalePreferencePending, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { addCivilDays, civilDateRange, instantCivilDate } from "@/lib/zonedDateTime";
import { activityLoadLevel } from "./activityLoad";
import { addDaysUtc, monthGridRange } from "./monthGrid";
import { useActivitiesMessages } from "./useActivitiesMessages";

const DOT_CLASS: Record<Exclude<ActivityLoadLevel, "none">, string> = {
  light: "bg-emerald-500",
  near: "bg-amber-500",
  full: "bg-red-500",
};

const GRID_RANGE_SLACK_DAYS = 1;
// A Solar Hijri month straddles Gregorian months. Cover the full visible grid
// whether `localMonth` is its first day or the current selection within it.
const PERSIAN_GRID_RADIUS_DAYS = 40;

function sameCalendarDayInUtc(localDay: Date): Date {
  return new Date(Date.UTC(localDay.getFullYear(), localDay.getMonth(), localDay.getDate()));
}

function rangeCoveringLocalDaysOfGrid(
  localMonth: Date,
  calendar: CalendarSystem,
): { from: Date; to: Date } {
  if (calendar === "persian") {
    const day = sameCalendarDayInUtc(localMonth);
    return {
      from: addDaysUtc(day, -PERSIAN_GRID_RADIUS_DAYS),
      to: addDaysUtc(day, PERSIAN_GRID_RADIUS_DAYS),
    };
  }
  const grid = monthGridRange(sameCalendarDayInUtc(localMonth));
  return {
    from: addDaysUtc(grid.from, -GRID_RANGE_SLACK_DAYS),
    to: addDaysUtc(grid.to, GRID_RANGE_SLACK_DAYS),
  };
}

interface Props {
  value: string | null;
  onChange: (v: string | null) => void;
  ariaLabel: string;
  placeholder?: string;
  assigneeId?: string | null;
}

export function ActivityDatePicker({
  value,
  onChange,
  ariaLabel,
  placeholder,
  assigneeId = null,
}: Props): React.ReactNode {
  const preferences = useLocalePreferences();
  const saving = useLocalePreferencePending();
  const S = useActivitiesMessages();
  const valueKey = value ?? "";
  const [calendarOverride, setCalendarOverride] = useState<CalendarSystem | null>(null);
  const calendar = calendarOverride ?? preferences.calendar;
  const selectedMonth =
    (value !== null ? parseYmd(value) : null) ??
    parseYmd(instantCivilDate(new Date(), preferences.timeZone))!;
  const [navigated, setNavigated] = useState<{ month: Date; forValue: string } | null>(null);
  const navigationStillApplies = navigated !== null && navigated.forValue === valueKey;
  const month = navigationStillApplies ? navigated.month : selectedMonth;
  const range = useMemo(() => {
    const grid = rangeCoveringLocalDaysOfGrid(month, calendar);
    return civilDateRange(
      grid.from.toISOString().slice(0, 10),
      addCivilDays(grid.to.toISOString().slice(0, 10), 1),
      preferences.timeZone,
    );
  }, [month, calendar, preferences.timeZone]);
  const { data } = trpc.activities.dayLoad.useQuery(
    {
      userId: assigneeId,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      timeZone: preferences.timeZone,
    },
    { enabled: !saving },
  );

  const dayAccessory = useMemo(() => {
    return (ymd: string): DayAccessory | null => {
      if (data === undefined) return null;
      const count = data.counts[ymd] ?? 0;
      const level = activityLoadLevel(count, data.target);
      if (level === "none") return null;
      return {
        indicator: <span className={`size-1.5 rounded-full ${DOT_CLASS[level]}`} />,
        hint: S.activityLoad(count, data.target),
      };
    };
  }, [data, S]);

  return (
    <DatePicker
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      dayAccessory={dayAccessory}
      onCalendarChange={(next) => {
        setCalendarOverride(next);
        setNavigated(null);
      }}
      onMonthChange={(m) => setNavigated({ month: m, forValue: valueKey })}
      onOpenChange={(open) => {
        if (!open) setNavigated(null);
      }}
    />
  );
}
