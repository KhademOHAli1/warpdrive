"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import type { EditableActivity } from "./getForEdit";
import type { ActivityUpdateInput } from "./schemas";
export interface CalendarEditorSettings {
  calendarId: string;
  eventVisibility: "default" | "private";
  availability: "busy" | "free";
}
export function useCalendarEventSettings(editing: EditableActivity | undefined) {
  const [initial] = useState<CalendarEditorSettings>({
    calendarId: editing?.calendarId ?? "",
    eventVisibility: editing?.eventVisibility ?? "default",
    availability: editing?.availability ?? "busy",
  });
  const [draft, setDraft] = useState(initial);
  const query = trpc.calendars.list.useQuery();
  const calendars = query.data ?? [];
  const writable = calendars.filter((c) => c.role === "owner" || c.role === "editor");
  const calendarId =
    editing === undefined && draft.calendarId === ""
      ? (writable.find((c) => c.isPrimary)?.id ?? writable[0]?.id ?? "")
      : draft.calendarId;
  return {
    calendars,
    source: calendars.find((c) => c.id === calendarId),
    settings: { ...draft, calendarId },
    changed: JSON.stringify(draft) !== JSON.stringify(initial),
    change: (patch: Partial<CalendarEditorSettings>) =>
      setDraft((current) => ({ ...current, ...patch })),
    patch: (): Partial<ActivityUpdateInput> => {
      const patch: Partial<ActivityUpdateInput> = {};
      if (draft.calendarId !== initial.calendarId && draft.calendarId !== "")
        patch.calendarId = draft.calendarId;
      if (draft.eventVisibility !== initial.eventVisibility)
        patch.eventVisibility = draft.eventVisibility;
      if (draft.availability !== initial.availability) patch.availability = draft.availability;
      return patch;
    },
  };
}
