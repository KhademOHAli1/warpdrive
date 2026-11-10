"use client";
import { Plus, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CalendarEventDialog } from "@/features/activities/CalendarEventDialog";
import { CalendarEventEditDialog } from "@/features/activities/CalendarEventEditDialog";
import { CalendarManager } from "@/features/activities/CalendarManager";
import type { CalendarActivity } from "@/features/activities/calendar";
import {
  type CalendarPoint,
  type CalendarSelection,
  movePreviewSelection,
} from "@/features/activities/calendarGesture";
import {
  type CalendarViewName,
  calendarHref,
  dayTitle,
  monthTitle,
  stepAnchorIso,
  weekTitle,
  yearTitle,
} from "@/features/activities/calendarView";
import { followUpLinksOf, useFollowUpAfterDone } from "@/features/activities/followUpAfterDone";
import {
  type CalendarRescheduleTarget,
  useCalendarReschedule,
} from "@/features/activities/useCalendarReschedule";
import { useLocalNow } from "@/features/activities/useLocalNow";
import { localDayIso } from "@/features/activities/weekAgenda";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { isOverlayOpen, isTypingTarget } from "@/features/shortcuts/shortcutTarget";
import { AgendaList } from "./AgendaList";
import { CalendarGesturePreview } from "./CalendarGesturePreview";
import { CalendarSavingPreview } from "./CalendarSavingPreview";
import { MonthView } from "./MonthView";
import { useCalendarDisplayedEvents } from "./useCalendarDisplayedEvents";
import { useCalendarPointer } from "./useCalendarPointer";
import { WeekAgendaGrid } from "./WeekAgendaGrid";
import { YearView } from "./YearView";

interface CalendarClientProps {
  view: CalendarViewName;
  anchorIso: string;
  dayIsos: string[];
  activities: CalendarActivity[];
  initialTodayIso?: string;
  // Shown above the empty grid so click/drag creation remains available. The caller owns
  // the wording because only it knows whether a filter is doing the excluding.
  empty?: React.ReactNode;
  onChanged?: () => void;
}

const PENDING_MESSAGE = {
  move: "interaction.moving",
  resize: "interaction.resizing",
  undo: "interaction.undoing",
} as const;

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
    agenda: dayTitle(anchorIso, preferences),
    week: t("weekOf", { date: weekTitle(dayIsos[0] ?? anchorIso, preferences) }),
    month: monthTitle(anchorIso, preferences),
    year: yearTitle(anchorIso, preferences),
  }[view];
  const rtl = preferences.locale === "fa";
  const [create, setCreate] = useState<CalendarSelection | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const promptAfterDone = useFollowUpAfterDone();
  const display = useCalendarDisplayedEvents(activities);
  const [gestureError, setGestureError] = useState<string | null>(null);
  const [savingPreview, setSavingPreview] = useState<{
    scope: string;
    selection: CalendarSelection;
    subject: string;
    kind: CalendarPoint["kind"];
  } | null>(null);
  const scopeKey = `${view}:${anchorIso}:${preferences.timeZone}:${preferences.locale}:${preferences.calendar}`;
  const reschedule = useCalendarReschedule({
    onMoved: display.confirm,
    onRefresh: () => onChanged?.(),
    onUncertain: display.forget,
  });
  const pendingLabel = t(PENDING_MESSAGE[reschedule.pendingOperation ?? "move"]);
  const displayed = reschedule.canMove ? display.activities : activities;
  const {
    root: calendarRoot,
    preview: pointerPreview,
    bindings: pointerBindings,
  } = useCalendarPointer({
    scopeKey,
    activities: displayed,
    timeZone: preferences.timeZone,
    disabled: view === "agenda" || reschedule.pending || create !== null || editingId !== null,
    onCreate: (selection) => {
      setGestureError(null);
      reschedule.clearFeedback();
      setCreate(selection);
    },
    onMove: (activity, target) => {
      void save(
        activity,
        target,
        movePreviewSelection(activity, target, preferences.timeZone),
        target.time === undefined ? "date" : "time",
      );
    },
    onResize: (activity, target, selection) => {
      void save(activity, target, selection, "time");
    },
    onInvalidMove: () => setGestureError(t("interaction.moveInvalid")),
  });

  async function save(
    activity: CalendarActivity,
    target: CalendarRescheduleTarget,
    selection: CalendarSelection | null,
    kind: CalendarPoint["kind"],
  ): Promise<void> {
    setGestureError(null);
    if (selection !== null)
      setSavingPreview({
        scope: scopeKey,
        selection,
        subject: activity.subject,
        kind,
      });
    const chips = Array.from(
      calendarRoot.current?.querySelectorAll<HTMLElement>("[data-calendar-event-id]") ?? [],
    ).filter((chip) => chip.dataset.calendarEventId === activity.id);
    for (const chip of chips) chip.setAttribute("data-calendar-pending", "true");
    try {
      await reschedule.move(activity, target);
    } finally {
      for (const chip of chips) chip.removeAttribute("data-calendar-pending");
      setSavingPreview(null);
    }
  }

  function renderView(): React.ReactNode {
    switch (view) {
      case "agenda":
        return (
          <AgendaList
            dateIso={anchorIso}
            activities={displayed}
            empty={empty}
            onOpenActivity={(activity) => setEditingId(activity.id)}
          />
        );
      case "day":
        return <WeekAgendaGrid view="day" dayIsos={dayIsos} activities={displayed} />;
      case "week":
        return <WeekAgendaGrid dayIsos={dayIsos} activities={displayed} />;
      case "month":
        return (
          <MonthView
            anchorIso={anchorIso}
            dayIsos={dayIsos}
            activities={displayed}
            todayIso={todayIso}
            onCreate={(date) => setCreate({ date, endDate: date })}
            onEdit={setEditingId}
          />
        );
      case "year":
        return <YearView anchorIso={anchorIso} activities={displayed} todayIso={todayIso} />;
    }
  }

  function handleMarkedDone(id: string): void {
    if (view !== "agenda") return;
    const activity = displayed.find((item) => item.id === id);
    if (activity !== undefined && promptAfterDone(followUpLinksOf(activity), onChanged))
      setEditingId(null);
  }

  return (
    // Not <main>: the app shell already owns that landmark, and a second one inside it hides the
    // shell's from assistive tech instead of adding anything.
    <section
      ref={calendarRoot}
      {...pointerBindings}
      aria-label={t("title")}
      aria-busy={reschedule.pending}
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
          create !== null ||
          editingId !== null
        )
          return;
        if (isTypingTarget(event.target) || isOverlayOpen(document)) return;
        event.preventDefault();
        setCreate({ date: anchorIso, endDate: anchorIso });
      }}
    >
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <CalendarManager onChanged={onChanged} />
        <Button
          onClick={() => {
            const date = view === "agenda" ? anchorIso : todayIso;
            setCreate({ date, endDate: date });
          }}
        >
          <Plus className="size-4" aria-hidden />
          {t("editor.create")}
        </Button>
        <div className="flex max-w-full flex-wrap gap-1 rounded-md border border-border p-0.5">
          {(["day", "agenda", "week", "month", "year"] as const).map((name) => (
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

      {view !== "year" && view !== "agenda" && (
        <p className="mb-3 text-xs text-muted-foreground">
          <span className="pointer-coarse:hidden">
            {t(view === "day" || view === "week" ? "interaction.timedHint" : "interaction.hint")}
          </span>
          <span className="hidden pointer-coarse:inline">{t("interaction.touchHint")}</span>
        </p>
      )}
      {(gestureError !== null || reschedule.error !== null) && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {gestureError ?? reschedule.error}
        </p>
      )}
      {(reschedule.pending || reschedule.notice !== null) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p role="status" className="text-sm text-muted-foreground">
            {reschedule.pending ? pendingLabel : reschedule.notice}
          </p>
          {reschedule.undoAvailable && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setGestureError(null);
                void reschedule.undo();
              }}
            >
              <Undo2 className="size-4" aria-hidden />
              {t("interaction.undo")}
            </Button>
          )}
        </div>
      )}
      <CalendarGesturePreview preview={pointerPreview} />
      {savingPreview?.scope === scopeKey && (
        <CalendarSavingPreview
          root={calendarRoot}
          selection={savingPreview.selection}
          subject={savingPreview.subject}
          kind={savingPreview.kind}
          label={pendingLabel}
        />
      )}

      {view !== "agenda" && displayed.length === 0 && empty}
      {renderView()}
      {create !== null && (
        <CalendarEventDialog
          defaultDate={create.date}
          defaultTime={create.time}
          defaultEndDate={create.endDate}
          defaultEndTime={create.endTime}
          onClose={() => setCreate(null)}
          onSaved={onChanged}
        />
      )}
      {editingId !== null && (
        <CalendarEventEditDialog
          id={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => onChanged?.()}
          onMarkedDone={handleMarkedDone}
        />
      )}
    </section>
  );
}
