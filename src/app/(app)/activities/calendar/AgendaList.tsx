"use client";

import { useRouter } from "next/navigation";
import type { CalendarActivity } from "@/features/activities/calendar";
import { calendarActivityTarget } from "@/features/activities/calendarActivityTarget";
import { groupByLocalDay } from "@/features/activities/weekAgenda";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useRecordPreview } from "@/features/navigation/recordPreviewStore";
import { addCivilDays, civilDateRange } from "@/lib/zonedDateTime";
import { calendarDayLabel, calendarStartTimeLabel } from "./calendarLabels";

export function agendaDay(
  activities: CalendarActivity[],
  dateIso: string,
  timeZone: string,
): { from: Date; items: CalendarActivity[] } {
  const { from } = civilDateRange(dateIso, addCivilDays(dateIso, 1), timeZone);
  const day = groupByLocalDay(activities, [dateIso], true, timeZone).get(dateIso) ?? [];
  // The range query can include an event that ends exactly when this civil day begins.
  const items = day.filter(
    (a) => a.allDay || a.dueAt >= from || (a.endAt != null && a.endAt > from),
  );
  return { from, items };
}

export function AgendaList({
  dateIso,
  activities,
  empty,
  onOpenActivity,
}: {
  dateIso: string;
  activities: CalendarActivity[];
  empty?: React.ReactNode;
  onOpenActivity: (activity: CalendarActivity) => void;
}): React.ReactNode {
  const preferences = useLocalePreferences();
  const t = useAppTranslations("calendar");
  const router = useRouter();
  const setPreview = useRecordPreview((state) => state.setPreview);
  const { from, items } = agendaDay(activities, dateIso, preferences.timeZone);
  const day = items.sort(
    (a, b) =>
      Number(b.allDay) - Number(a.allDay) ||
      a.dueAt.getTime() - b.dueAt.getTime() ||
      a.id.localeCompare(b.id),
  );

  return (
    <div data-calendar-agenda className="min-w-0">
      {day.length === 0 ? (
        empty
      ) : (
        <ol
          // biome-ignore lint/a11y/noRedundantRoles: Preserve Safari list semantics when the CSS reset hides markers.
          role="list"
          aria-label={calendarDayLabel(dateIso, preferences)}
          className="divide-y divide-border rounded-md border border-border bg-card"
        >
          {day.map((activity) => {
            const target = calendarActivityTarget(activity);
            const start = new Date(Math.max(activity.dueAt.getTime(), from.getTime()));
            return (
              <li key={activity.id}>
                <button
                  type="button"
                  data-calendar-event-id={activity.id}
                  className="flex min-h-11 w-full items-baseline gap-3 px-3 py-2.5 text-start text-sm hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => {
                    if (target.kind === "edit") {
                      onOpenActivity(activity);
                    } else {
                      setPreview(target.preview);
                      router.push(target.href);
                    }
                  }}
                >
                  <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {activity.allDay ? (
                      t("allDay")
                    ) : (
                      <time dateTime={start.toISOString()}>
                        {calendarStartTimeLabel(start, preferences)}
                      </time>
                    )}
                  </span>{" "}
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <bdi className="block font-medium">{activity.subject}</bdi>
                    {target.kind === "record" && (
                      <>
                        {" "}
                        <bdi className="block text-xs text-muted-foreground">
                          {target.preview.title}
                        </bdi>
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
