"use client";
import { useState } from "react";
import type { EditableActivity } from "./getForEdit";
import { DEFAULT_REMINDER_RULES, type ReminderSelection } from "./reminderPolicy";
import { setEventReminderSettingsAction } from "./reminderSettingsActions";
import type { CalendarReminderContext } from "./reminderSettingsState";

export function useCalendarPersonalReminderDraft(
  editing: EditableActivity | undefined,
  calendar: CalendarReminderContext | undefined,
  calendarId = editing?.calendarId,
) {
  const context = editing?.personalReminders;
  const effective =
    editing !== undefined && calendarId === editing.calendarId ? (context ?? calendar) : calendar;
  const [initial] = useState<ReminderSelection>(context?.selection ?? { useDefault: true });
  const [selection, setSelection] = useState(initial);
  const [rawChanged, setRawChanged] = useState(false);
  const [valid, setValid] = useState(true);
  const [reveal, setReveal] = useState(false);
  const changed = JSON.stringify(selection) !== JSON.stringify(initial);
  const write = { selection, expectedRevision: context?.revision ?? 0 };
  return {
    selection,
    setSelection,
    changed,
    rawChanged,
    setRawChanged,
    setValid,
    reveal,
    defaults: effective?.defaults ?? DEFAULT_REMINDER_RULES,
    emailCapability: effective?.emailCapability ?? "mailboxMissing",
    write: changed ? write : undefined,
    validate: () => {
      setReveal(!valid);
      return valid;
    },
    save: (activityId: string, csrf: string | null) =>
      setEventReminderSettingsAction({ activityId, ...write }, csrf),
  };
}
