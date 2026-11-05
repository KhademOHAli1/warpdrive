"use client";
import { memo, useCallback, useRef, useState } from "react";
import type { layoutTimed } from "@/features/activities/agendaLayout";
import { DEFAULT_START_HOUR } from "@/features/activities/agendaScroll";
import type { CalendarActivity } from "@/features/activities/calendar";
import { HOUR_HEIGHT_PX, HOURS } from "@/features/activities/weekAgenda";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { ActivityChip } from "./calendarChip";
import { calendarDayLabel, calendarHourLabel } from "./calendarLabels";
import { MoreActivitiesChip } from "./MoreActivitiesChip";

const COLUMN_HEIGHT_PX = HOURS.length * HOUR_HEIGHT_PX;

// Reserve room for the localized count beside the visible event lanes.
export const TIMED_OVERFLOW_WIDTH_PX = 80;

function laneSize(percent: number, overflowing: boolean): string {
  return overflowing
    ? `calc(${percent}% - ${(percent * TIMED_OVERFLOW_WIDTH_PX) / 100}px)`
    : `${percent}%`;
}

interface AgendaDayColumnProps {
  iso: string;
  dayLabel: string;
  layout: ReturnType<typeof layoutTimed>;
  onOpenActivity: (activity: CalendarActivity) => void;
  onOpenSlot: (iso: string, hour: number) => void;
}

// One day's hour grid: 24 click-to-create lanes with the day's timed activities positioned over
// them. The activities are rendered FIRST so they come first in the tab order (they are the
// content; the lanes are an affordance), and z-index still paints them above.
export const AgendaDayColumn = memo(function AgendaDayColumn({
  iso,
  dayLabel,
  layout,
  onOpenActivity,
  onOpenSlot,
}: AgendaDayColumnProps): React.ReactNode {
  const preferences = useLocalePreferences();
  const t = useAppTranslations("calendar");
  const { placements, overflows } = layout;
  const ref = useRef<HTMLDivElement>(null);
  // Roving tabindex: one lane per column is in the tab order and the arrows walk the rest, so a
  // week costs 7 tab stops instead of 168 before the keyboard reaches anything.
  const [focusHour, setFocusHour] = useState(DEFAULT_START_HOUR);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, hour: number) => {
    const delta = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = Math.min(HOURS.length - 1, Math.max(0, hour + delta));
    setFocusHour(next);
    ref.current?.querySelector<HTMLButtonElement>(`[data-hour="${next}"]`)?.focus();
  }, []);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a calendar day column is not a form <fieldset>
    <div
      ref={ref}
      data-calendar-surface="time"
      data-calendar-date={iso}
      role="group"
      aria-label={dayLabel}
      className="relative select-none border-s border-border"
      style={{ height: COLUMN_HEIGHT_PX }}
    >
      {placements.map(
        ({ activity, topPx, heightPx, leftPct, widthPct, overflowing, resizeStart, resizeEnd }) => (
          <div
            key={activity.id}
            className="absolute z-10 overflow-hidden px-px"
            style={{
              top: topPx,
              height: heightPx,
              insetInlineStart: laneSize(leftPct, overflowing),
              width: laneSize(widthPct, overflowing),
            }}
          >
            <ActivityChip
              a={activity}
              onOpen={onOpenActivity}
              className="h-full"
              resizeStart={resizeStart && heightPx >= 12}
              resizeEnd={resizeEnd && heightPx >= 12}
            />
          </div>
        ),
      )}
      {overflows.map(({ activities, topPx, heightPx }) => (
        <div
          key={`more-${activities[0]?.id ?? topPx}`}
          className="absolute end-0 z-10 px-px"
          style={{
            top: topPx,
            height: heightPx,
            width: TIMED_OVERFLOW_WIDTH_PX,
            // The block is as tall as the span it stands for while the chip is one line; the rest
            // lets clicks through to the hour lanes instead of eating them.
            pointerEvents: "none",
          }}
        >
          <MoreActivitiesChip activities={activities} onOpen={onOpenActivity} />
        </div>
      ))}
      {HOURS.map((hour) => (
        <button
          key={hour}
          type="button"
          data-hour={hour}
          tabIndex={hour === focusHour ? 0 : -1}
          aria-label={t("addActivitySlot", {
            date:
              preferences.locale === "en" && preferences.calendar === "gregory"
                ? iso
                : calendarDayLabel(iso, preferences),
            time: calendarHourLabel(hour, preferences),
          })}
          onClick={() => onOpenSlot(iso, hour)}
          onKeyDown={(e) => onKeyDown(e, hour)}
          className="absolute inset-x-0 border-t border-border/60 hover:bg-accent/30"
          style={{ top: hour * HOUR_HEIGHT_PX, height: HOUR_HEIGHT_PX }}
        />
      ))}
    </div>
  );
});
