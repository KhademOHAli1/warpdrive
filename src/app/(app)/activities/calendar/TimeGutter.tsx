"use client";
import { HOUR_HEIGHT_PX, HOURS } from "@/features/activities/weekAgenda";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { calendarHourLabel } from "./calendarLabels";

// The time axis. Without it a block's vertical position encodes its time and nothing decodes it.
// aria-hidden because every hour lane already carries the same time in its own label, so exposing
// the axis would add 23 stray text nodes between a screen reader and the activities.
export function TimeGutter(): React.ReactNode {
  const preferences = useLocalePreferences();
  return (
    <div
      aria-hidden
      className="relative border-e border-border bg-muted/40"
      style={{ height: HOURS.length * HOUR_HEIGHT_PX }}
    >
      {/* Midnight is the grid's top edge, so its label would sit half outside the column. */}
      {HOURS.slice(1).map((hour) => (
        <div
          key={hour}
          className="absolute end-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
          style={{ top: hour * HOUR_HEIGHT_PX }}
        >
          {calendarHourLabel(hour, preferences)}
        </div>
      ))}
    </div>
  );
}
