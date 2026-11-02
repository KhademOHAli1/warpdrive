"use client";
import { useCallback, useRef, useState } from "react";
import { reportTimePickerValidity } from "@/components/ui/timePickerValidity";
import {
  type ActivityDraft,
  buildActivityInput,
} from "@/features/deal-workspace/composer/composerHelpers";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { instantCivilDate } from "@/lib/zonedDateTime";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  completeActivityAction,
  createActivityAction,
  deleteActivityAction,
  editActivityAction,
} from "./actions";
import { localizeActivityTypes } from "./activityTypeLabels";
import {
  calendarEventDraft,
  calendarEventIssue,
  calendarEventPatch,
  moveCalendarStart,
} from "./calendarEventDraft";
import type { EditableActivity } from "./getForEdit";
import { useActivitiesMessages } from "./useActivitiesMessages";
import { useInvalidateActivityLists } from "./useInvalidateActivityLists";

export interface CalendarEventDialogProps {
  defaultDate?: string;
  defaultTime?: string;
  editing?: EditableActivity;
  onClose: () => void;
  onSaved?: () => void;
  onMarkedDone?: (id: string) => void;
}

export function useCalendarEventEditor({
  defaultDate,
  defaultTime = "",
  editing,
  onClose,
  onSaved,
  onMarkedDone,
}: CalendarEventDialogProps) {
  const preferences = useLocalePreferences();
  const [zone] = useState(preferences.timeZone);
  const t = useAppTranslations("calendar");
  const S = useActivitiesMessages();
  const fields = useRef<HTMLFieldSetElement>(null);
  const attachFields = useCallback((node: HTMLFieldSetElement | null) => {
    fields.current = node;
  }, []);
  const submitting = useRef(false);
  const invalidate = useInvalidateActivityLists();
  const types = localizeActivityTypes(
    trpc.activities.listTypes.useQuery().data ?? [],
    preferences.locale,
  );
  const [draft, setDraft] = useState(() =>
    calendarEventDraft({
      date: defaultDate ?? instantCivilDate(new Date(), zone),
      time: defaultTime,
      editing,
      timeZone: zone,
    }),
  );
  const [details, setDetails] = useState(editing !== undefined);
  const [timed, setTimed] = useState({
    start: draft.startTime || "09:00",
    end: draft.endTime || "10:00",
  });
  const [pending, setPending] = useState(false);
  const [doneNow, setDoneNow] = useState(editing?.done ?? false);
  const [error, setError] = useState<string | null>(null);
  const value = { ...draft, typeId: draft.typeId || (types[0]?.id ?? "") };
  function change(patch: Partial<ActivityDraft>): void {
    setDraft((current) => ({ ...current, ...patch }));
  }
  function allDay(enabled: boolean): void {
    if (enabled) {
      setTimed({ start: draft.startTime, end: draft.endTime });
      change({ startTime: "", endTime: "" });
    } else change({ startTime: timed.start || "09:00", endTime: timed.end || "10:00" });
  }
  async function save(): Promise<void> {
    if (submitting.current || !reportTimePickerValidity(fields.current)) return;
    const issue = calendarEventIssue(value, zone, editing);
    if (issue !== null) {
      setError(t(`editor.${issue}`));
      return;
    }
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const csrf = readCsrfToken();
      const patch = editing === undefined ? null : calendarEventPatch(editing, value, zone);
      if (editing !== undefined && patch === null) {
        onClose();
        return;
      }
      const result =
        patch !== null
          ? await editActivityAction(patch, csrf)
          : await createActivityAction(buildActivityInput(value, zone), csrf);
      if (!result.ok) {
        setError(
          editing === undefined ? S.createFailed(result.error.id) : S.saveFailed(result.error.id),
        );
        return;
      }
      await invalidate();
      onSaved?.();
      onClose();
    } catch {
      setError(t("editor.saveFailed"));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  async function manage(kind: "delete" | "complete"): Promise<void> {
    if (editing === undefined || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const result =
        kind === "delete"
          ? await deleteActivityAction({ id: editing.id }, readCsrfToken())
          : await completeActivityAction({ id: editing.id, done: !doneNow }, readCsrfToken());
      if (!result.ok) {
        setError(
          kind === "delete" ? S.deleteFailed(result.error.id) : S.updateFailed(result.error.id),
        );
        return;
      }
      await invalidate();
      onSaved?.();
      if (kind === "delete") onClose();
      else {
        setDoneNow(!doneNow);
        if (!doneNow) onMarkedDone?.(editing.id);
      }
    } catch {
      setError(t("editor.saveFailed"));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return {
    preferences,
    zone,
    t,
    S,
    attachFields,
    canClose: () => !submitting.current,
    types,
    draft,
    value,
    details,
    setDetails,
    pending,
    doneNow,
    error,
    change,
    allDay,
    save,
    manage,
    moveStart: (next: { date: string; time: string }) =>
      setDraft((current) => moveCalendarStart(current, next, zone, editing)),
  };
}
