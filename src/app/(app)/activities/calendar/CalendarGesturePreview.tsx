"use client";

import { createPortal } from "react-dom";
import { formatCalendarDate } from "@/features/activities/calendarSystem";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { calendarDayLabel } from "./calendarLabels";
import type { CalendarPointerPreview } from "./useCalendarPointer";

export function CalendarGesturePreview({
  preview,
  saving = false,
}: {
  preview: CalendarPointerPreview | null;
  saving?: boolean;
}): React.ReactNode {
  const preferences = useLocalePreferences();
  const t = useAppTranslations("calendar");
  if (preview === null) return null;
  const { selection } = preview;
  const labelPoint = (date: string, time?: string): string => {
    if (time === undefined) return calendarDayLabel(date, preferences);
    const clock = formatCalendarDate(new Date(`${date}T${time}:00Z`), preferences, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return selection.date === selection.endDate
      ? clock
      : `${calendarDayLabel(date, preferences)} ${clock}`;
  };
  const range = t("interaction.range", {
    start: labelPoint(selection.date, selection.time),
    end: labelPoint(selection.endDate, selection.endTime),
  });
  const label = saving
    ? t("interaction.moving")
    : `${preview.subject ?? t("editor.create")} · ${range}`;
  return createPortal(
    <>
      <span className="sr-only" role="status">
        {label}
      </span>
      {preview.boxes.map((box, index) => (
        <div
          key={box.key}
          aria-hidden
          className="pointer-events-none fixed z-40 overflow-hidden rounded border-2 border-primary bg-primary/20 p-1 text-xs font-medium text-foreground shadow-sm"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        >
          {index === 0 && <span className="rounded bg-card/90 px-1 py-0.5">{label}</span>}
        </div>
      ))}
    </>,
    document.body,
  );
}
