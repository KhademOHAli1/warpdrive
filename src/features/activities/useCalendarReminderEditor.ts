"use client";
import { useState } from "react";
import {
  initialCalendarReminder,
  reminderForEventKind,
  sameReminderSelection,
} from "./calendarReminderDraft";
import type { EditableActivity } from "./getForEdit";
import type { ActivityReminderSelectionV1 } from "./reminderIntentTypes";

export function useCalendarReminderEditor(editing: EditableActivity | undefined, zone: string) {
  const [metadata, setMetadata] = useState(editing?.reminder ?? null);
  const [selection, setSelection] = useState(() => initialCalendarReminder(editing));
  const [reminderZone, setReminderZone] = useState(editing?.reminder?.reminderTimeZone ?? zone);
  const [changed, setChanged] = useState(false);
  const [clock, setClock] = useState(
    editing?.reminder?.selection?.kind === "all_day_at"
      ? editing.reminder.selection.localTime
      : "09:00",
  );
  function choose(next: ActivityReminderSelectionV1): void {
    setChanged(true);
    setSelection(next);
    if (next.kind === "all_day_at") setClock(next.localTime);
  }
  function enable(enabled: boolean, allDay: boolean): void {
    choose(
      enabled
        ? allDay
          ? { kind: "all_day_at", channel: "in_app", localTime: clock }
          : { kind: "before_start", channel: "in_app", leadMinutes: 10 }
        : { kind: "none" },
    );
  }
  function eventKind(allDay: boolean): void {
    const next = reminderForEventKind(selection, allDay, clock);
    if (next !== null && !sameReminderSelection(selection, next)) choose(next);
  }
  function refresh(next: EditableActivity): void {
    setMetadata(next.reminder ?? null);
    if (!changed) {
      setSelection(initialCalendarReminder(next));
      setReminderZone(next.reminder?.reminderTimeZone ?? zone);
    }
  }
  return {
    metadata,
    selection,
    reminderZone,
    changed,
    enable,
    eventKind,
    refresh,
    legacyWarning:
      editing !== undefined && metadata === null && changed && selection?.kind !== "none",
    chooseTime: (localTime: string) => choose({ kind: "all_day_at", channel: "in_app", localTime }),
    patch: () =>
      changed && selection !== null ? { reminder: selection, reminderTimeZone: reminderZone } : {},
  };
}
