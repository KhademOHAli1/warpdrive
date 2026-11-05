"use client";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CalendarEventDialog } from "@/features/activities/CalendarEventDialog";
import { CalendarEventEditDialog } from "@/features/activities/CalendarEventEditDialog";
import type { CalendarActivity } from "@/features/activities/calendar";
import {
  type CalendarViewName,
  calendarHref,
  dayTitle,
  monthTitle,
  stepAnchorIso,
  weekTitle,
  yearTitle,
} from "@/features/activities/calendarView";
import { useLocalNow } from "@/features/activities/useLocalNow";
import { localDayIso } from "@/features/activities/weekAgenda";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { isOverlayOpen, isTypingTarget } from "@/features/shortcuts/shortcutTarget";
import { MonthView } from "./MonthView";
import { WeekAgendaGrid } from "./WeekAgendaGrid";
import { YearView } from "./YearView";

interface CalendarClientProps {
  view: CalendarViewName;
  anchorIso: string;
  dayIsos: string[];
  activities: CalendarActivity[];
  initialTodayIso?: string;
  // Shown instead of the grid when the window holds nothing. The caller owns the wording because
  // only it knows whether a filter is doing the excluding, and an empty grid says nothing at all.
  empty?: React.ReactNode;
  onChanged?: () => void;
}

function tab(active: boolean): string {
  return active
    ? "px-3 py-1 text-sm rounded-sm bg-accent text-accent-foreground font-medium"
    : "px-3 py-1 text-sm rounded-sm text-muted-foreground hover:bg-accent/60";
}

export function CalendarClient({
  view,
  anchorIso,
  dayIsos,
  activities,
  initialTodayIso = anchorIso,
  empty,
  onChanged,
}: CalendarClientProps): React.ReactNode {
  const preferences = useLocalePreferences();
  const t = useAppTranslations("calendar");
  const prevIso = stepAnchorIso(view, anchorIso, -1, preferences);
  const nextIso = stepAnchorIso(view, anchorIso, 1, preferences);
  const now = useLocalNow();
  const todayIso = now === null ? initialTodayIso : localDayIso(now, preferences.timeZone);
  const label = {
    day: dayTitle(anchorIso, preferences),
    week: t("weekOf", { date: weekTitle(dayIsos[0] ?? anchorIso, preferences) }),
    month: monthTitle(anchorIso, preferences),
    year: yearTitle(anchorIso, preferences),
  }[view];
  const rtl = preferences.locale === "fa";
  const [createDate, setCreateDate] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    // Not <main>: the app shell already owns that landmark, and a second one inside it hides the
    // shell's from assistive tech instead of adding anything.
    <section
      aria-label={t("title")}
      className="p-4"
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey ||
          event.nativeEvent.isComposing ||
          event.nativeEvent.keyCode === 229 ||
          !(event.target instanceof Node) ||
          !event.currentTarget.contains(event.target) ||
          event.key.toLowerCase() !== "c" ||
          createDate !== null ||
          editingId !== null
        )
          return;
        if (isTypingTarget(event.target) || isOverlayOpen(document)) return;
        event.preventDefault();
        setCreateDate(anchorIso);
      }}
    >
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => setCreateDate(todayIso)}>
          <Plus className="size-4" aria-hidden />
          {t("editor.create")}
        </Button>
        <div className="flex gap-1 rounded-md border border-border p-0.5">
          {(["day", "week", "month", "year"] as const).map((name) => (
            <Link
              key={name}
              aria-current={view === name ? "page" : undefined}
              href={calendarHref(name, anchorIso)}
              className={tab(view === name)}
            >
              {t(name)}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Link
            aria-label={t("previous")}
            href={calendarHref(view, prevIso)}
            className="px-2 py-1 text-sm rounded border border-border hover:bg-accent/60"
          >
            <span aria-hidden>{rtl ? ">" : "<"}</span>
          </Link>
          <Link
            href={calendarHref(view, todayIso)}
            className="px-2 py-1 text-sm rounded border border-border hover:bg-accent/60"
          >
            {t("today")}
          </Link>
          <Link
            aria-label={t("next")}
            href={calendarHref(view, nextIso)}
            className="px-2 py-1 text-sm rounded border border-border hover:bg-accent/60"
          >
            <span aria-hidden>{rtl ? "<" : ">"}</span>
          </Link>
        </div>
        {/* The heading for the window being shown; the page had no heading of any level under
            its h1 for a screen reader to move between. */}
        <h2 className="text-sm font-medium text-foreground tabular-nums">{label}</h2>
      </header>

      {view === "year" ? (
        <>
          {activities.length === 0 && empty}
          <YearView anchorIso={anchorIso} activities={activities} todayIso={todayIso} />
        </>
      ) : view === "day" ? (
        <>
          {activities.length === 0 && empty}
          <WeekAgendaGrid dayIsos={dayIsos} activities={activities} />
        </>
      ) : empty !== undefined && activities.length === 0 ? (
        empty
      ) : view === "month" ? (
        <MonthView
          anchorIso={anchorIso}
          dayIsos={dayIsos}
          activities={activities}
          todayIso={todayIso}
          onCreate={setCreateDate}
          onEdit={setEditingId}
        />
      ) : (
        <WeekAgendaGrid dayIsos={dayIsos} activities={activities} />
      )}
      {createDate !== null && (
        <CalendarEventDialog
          defaultDate={createDate}
          onClose={() => setCreateDate(null)}
          onSaved={onChanged}
        />
      )}
      {editingId !== null && (
        <CalendarEventEditDialog
          id={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => onChanged?.()}
        />
      )}
    </section>
  );
}
