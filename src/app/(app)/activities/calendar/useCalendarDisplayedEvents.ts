"use client";

import { useCallback, useState } from "react";
import type { CalendarActivity } from "@/features/activities/calendar";
import type { CalendarRescheduleValue } from "@/features/activities/calendarRescheduleSchemas";

interface ConfirmedDisplay {
  base: CalendarActivity[];
  values: Record<string, CalendarRescheduleValue>;
}

export function useCalendarDisplayedEvents(incoming: CalendarActivity[]) {
  const [confirmed, setConfirmed] = useState<ConfirmedDisplay>({ base: incoming, values: {} });
  // A new server list supersedes every local acknowledgment. Resetting the identity as well as
  // ignoring old values prevents an earlier list object from reviving an obsolete move later.
  if (confirmed.base !== incoming) setConfirmed({ base: incoming, values: {} });

  const confirm = useCallback(
    (schedule: CalendarRescheduleValue): void => {
      setConfirmed((current) => {
        if (current.base !== incoming) return current;
        return { ...current, values: { ...current.values, [schedule.id]: { ...schedule } } };
      });
    },
    [incoming],
  );

  const forget = useCallback((id: string): void => {
    setConfirmed((current) => {
      if (current.values[id] === undefined) return current;
      const values = { ...current.values };
      delete values[id];
      return { ...current, values };
    });
  }, []);

  const activities =
    confirmed.base !== incoming
      ? incoming
      : incoming.map((activity) => {
          const schedule = confirmed.values[activity.id];
          if (schedule === undefined) return activity;
          return {
            ...activity,
            dueAt: new Date(schedule.dueAt),
            endAt: schedule.endAt === null ? null : new Date(schedule.endAt),
            allDay: schedule.allDay,
            dueDate: schedule.dueDate,
            endDate: schedule.endDate,
            durationMinutes: schedule.durationMinutes,
          };
        });

  return { activities, confirm, forget };
}
