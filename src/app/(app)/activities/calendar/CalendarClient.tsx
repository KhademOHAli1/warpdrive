"use client";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { CalendarEventDialog } from "@/features/activities/CalendarEventDialog";
import { CalendarEventEditDialog } from "@/features/activities/CalendarEventEditDialog";
import type { CalendarActivity } from "@/features/activities/calendar";
import {
  type CalendarViewName,
  calendarHref,
  monthTitle,
  stepAnchorIso,
  weekTitle,
} from "@/features/activities/calendarView";
import { useLocalNow } from "@/features/activities/useLocalNow";
import { localDayIso } from "@/features/activities/weekAgenda";
import {
  useAppTranslations,
  useLocalePreferences,
  useSetLocalePreferences,
} from "@/features/i18n/LocaleProvider";
import { isOverlayOpen, isTypingTarget } from "@/features/shortcuts/shortcutTarget";
import { MonthView } from "./MonthView";
import { WeekAgendaGrid } from "./WeekAgendaGrid";

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
  const setPreferences = useSetLocalePreferences();
  const t = useAppTranslations("calendar");
  const prevIso = stepAnchorIso(view, anchorIso, -1, preferences);
  const nextIso = stepAnchorIso(view, anchorIso, 1, preferences);
  const now = useLocalNow();
  const todayIso = now === null ? initialTodayIso : localDayIso(now, preferences.timeZone);
  const label =
    view === "month"
      ? monthTitle(anchorIso, preferences)
      : t("weekOf", { date: weekTitle(dayIsos[0] ?? anchorIso, preferences) });
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
          <Link
            aria-current={view === "week" ? "page" : undefined}
            href={calendarHref("week", anchorIso)}
            className={tab(view === "week")}
          >
            {t("week")}
          </Link>
          <Link
            aria-current={view === "month" ? "page" : undefined}
            href={calendarHref("month", anchorIso)}
            className={tab(view === "month")}
          >
            {t("month")}
          </Link>
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
        <Select
          ariaLabel={t("calendarSystem")}
          triggerClassName="w-40"
          value={preferences.calendar}
          options={[
            { value: "gregory", label: t("gregory") },
            { value: "persian", label: t("persian") },
          ]}
          onChange={(calendar) => {
            if (calendar === "gregory" || calendar === "persian") void setPreferences({ calendar });
          }}
        />
      </header>

      {empty !== undefined && activities.length === 0 ? (
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
