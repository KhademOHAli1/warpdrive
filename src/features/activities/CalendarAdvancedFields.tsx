"use client";
import { useEffect, useMemo, useRef } from "react";
import { CalendarEventOwnership } from "./CalendarEventOwnership";
import { CalendarEventTimeZone } from "./CalendarEventTimeZone";
import { CalendarReminderEditor } from "./CalendarReminderEditor";
import type { EditableActivity } from "./getForEdit";
import type { ActivityUpdateInput } from "./schemas";
import { useCalendarEventSettings } from "./useCalendarEventSettings";
import { useCalendarPersonalReminderDraft } from "./useCalendarPersonalReminderDraft";

export interface AdvancedCalendarDraft {
  patch: Partial<ActivityUpdateInput>;
  valid: boolean;
  changed: boolean;
}

export function CalendarAdvancedFields({
  editing,
  allDay,
  timeZone,
  onTimeZone,
  onChange,
}: {
  editing?: EditableActivity;
  allDay: boolean;
  timeZone: string;
  onTimeZone: (value: string) => void;
  onChange: (value: AdvancedCalendarDraft) => void;
}): React.ReactNode {
  const calendar = useCalendarEventSettings(editing);
  const personal = useCalendarPersonalReminderDraft(
    editing,
    calendar.source?.personalReminders,
    calendar.settings.calendarId,
  );
  const calendarReminders = editing === undefined || editing.reminder == null;
  const value = useMemo<AdvancedCalendarDraft>(() => {
    const patch: Partial<ActivityUpdateInput> = {
      ...(editing === undefined
        ? {
            calendarId: calendar.settings.calendarId || undefined,
            eventVisibility: calendar.settings.eventVisibility,
            availability: calendar.settings.availability,
          }
        : calendar.patch()),
      ...(calendarReminders && (editing === undefined || personal.changed)
        ? {
            personalReminders: {
              selection: personal.selection,
              expectedRevision: editing?.personalReminders?.revision ?? 0,
            },
          }
        : {}),
    };
    return {
      patch,
      valid: calendar.settings.calendarId !== "" && personal.valid,
      changed: calendar.changed || personal.changed || personal.rawChanged,
    };
  }, [editing, calendar, personal, calendarReminders]);
  const signature = JSON.stringify(value);
  const published = useRef<string | null>(null);
  useEffect(() => {
    if (published.current === signature) return;
    published.current = signature;
    onChange(value);
  }, [signature, value, onChange]);
  return (
    <div className="space-y-4 rounded-md border border-border p-3">
      <CalendarEventOwnership
        settings={calendar.settings}
        calendars={calendar.calendars}
        legacy={editing?.calendarId == null}
        reveal
        onChange={calendar.change}
      />
      <CalendarEventTimeZone value={timeZone} onChange={onTimeZone} compact />
      {calendarReminders && (
        <CalendarReminderEditor
          value={personal.selection}
          defaults={personal.defaults}
          allDay={allDay}
          timeZone={timeZone}
          emailCapability={personal.emailCapability}
          onChange={personal.setSelection}
          onRawChange={personal.setRawChanged}
          onValidityChange={personal.setValid}
        />
      )}
    </div>
  );
}
