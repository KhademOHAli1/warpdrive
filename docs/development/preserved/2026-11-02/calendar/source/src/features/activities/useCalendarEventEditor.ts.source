"use client";
import { useCallback, useRef, useState } from "react";
import { reportTimePickerValidity } from "@/components/ui/timePickerValidity";
import { ERROR_IDS } from "@/constants/errorIds";
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
import type { ActivityUpdateInput } from "./schemas";
import { useActivitiesMessages } from "./useActivitiesMessages";
import { useCalendarDraftGuard } from "./useCalendarDraftGuard";
import { useCalendarEventSettings } from "./useCalendarEventSettings";
import { useCalendarPersonalReminderDraft } from "./useCalendarPersonalReminderDraft";
import { useInvalidateActivityLists } from "./useInvalidateActivityLists";

export interface CalendarEventDialogProps {
  defaultDate?: string;
  defaultTime?: string;
  defaultEndDate?: string;
  defaultEndTime?: string;
  editing?: EditableActivity;
  onClose: () => void;
  onSaved?: () => void;
  onMarkedDone?: (id: string) => void;
}

export function useCalendarEventEditor({
  defaultDate,
  defaultTime = "",
  defaultEndDate,
  defaultEndTime,
  editing,
  onClose,
  onSaved,
  onMarkedDone,
}: CalendarEventDialogProps) {
  const preferences = useLocalePreferences();
  const calendar = useCalendarEventSettings(editing);
  const personal = useCalendarPersonalReminderDraft(
    editing,
    calendar.source?.personalReminders,
    calendar.settings.calendarId,
  );
  const sourceZone = editing === undefined ? calendar.source?.timeZone : undefined;
  const [initialZone, setInitialZone] = useState(
    editing?.eventTimeZone ?? sourceZone ?? preferences.timeZone,
  );
  const [zone, setZoneValue] = useState(initialZone);
  const [sourceApplied, setSourceApplied] = useState(
    editing !== undefined || sourceZone !== undefined,
  );
  if (!sourceApplied && sourceZone !== undefined) {
    setSourceApplied(true);
    setInitialZone(sourceZone);
    setZoneValue(sourceZone);
  }
  function setZone(next: string): void {
    setSourceApplied(true);
    setZoneValue(next);
  }
  const [version, setVersion] = useState(editing?.version);
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
  const [initial] = useState(() => ({
    ...calendarEventDraft({
      date: defaultDate ?? instantCivilDate(new Date(), zone),
      time: defaultTime,
      editing,
      timeZone: zone,
    }),
    ...(editing === undefined && defaultEndTime !== undefined
      ? { endDate: defaultEndDate ?? defaultDate ?? "", endTime: defaultEndTime }
      : {}),
  }));
  const [draft, setDraft] = useState(initial);
  const [details, setDetails] = useState(editing !== undefined);
  const [timed, setTimed] = useState({
    start: draft.startTime || "09:00",
    end: draft.endTime || "10:00",
  });
  const [pending, setPending] = useState(false);
  const guard = useCalendarDraftGuard({
    draft,
    initial,
    fields,
    pending,
    onClose,
    extraChanged:
      zone !== initialZone || calendar.changed || personal.changed || personal.rawChanged,
  });
  const [doneNow, setDoneNow] = useState(editing?.done ?? false);
  const [error, setError] = useState<string | null>(null);
  const defaultType = types.find((type) => type.key === "meeting") ?? types[0];
  const value = { ...draft, typeId: draft.typeId || (defaultType?.id ?? "") };
  function change(patch: Partial<ActivityDraft>): void {
    setDraft((current) => ({ ...current, ...patch }));
  }
  function allDay(enabled: boolean): void {
    if (enabled) {
      setTimed({ start: draft.startTime, end: draft.endTime });
      change({ startTime: "", endTime: "" });
    } else change({ startTime: timed.start || "09:00", endTime: timed.end || "10:00" });
  }
  function revision(): { expectedVersion?: number } {
    return version === undefined ? {} : { expectedVersion: version };
  }
  function editPatch(): ActivityUpdateInput | null {
    if (editing === undefined) return null;
    const patch = calendarEventPatch({ ...editing, version }, value, zone);
    const metadata: Partial<ActivityUpdateInput> = calendar.patch();
    if (zone !== initialZone) metadata.eventTimeZone = zone;
    return Object.keys(metadata).length === 0
      ? patch
      : { ...(patch ?? { id: editing.id }), ...metadata, ...revision() };
  }
  function actionError(id: string, kind: "create" | "save" | "delete" | "complete"): string {
    if (id === ERROR_IDS.ACTIVITY_CONFLICT) return t("editor.conflict");
    switch (kind) {
      case "create":
        return S.createFailed(id);
      case "save":
        return S.saveFailed(id);
      case "delete":
        return S.deleteFailed(id);
      case "complete":
        return S.updateFailed(id);
    }
  }
  async function submitSave(patch: ActivityUpdateInput | null, csrf: string | null) {
    if (editing !== undefined && patch === null) return personal.save(editing.id, csrf);
    if (patch !== null)
      return editActivityAction({ ...patch, personalReminders: personal.write }, csrf);
    return createActivityAction(
      {
        ...buildActivityInput(value, zone),
        eventTimeZone: zone,
        ...calendar.settings,
        personalReminders: personal.write,
      },
      csrf,
    );
  }
  async function save(): Promise<void> {
    if (submitting.current) return;
    if (!personal.validate()) {
      setError(t("reminders.needsReview"));
      return;
    }
    if (!reportTimePickerValidity(fields.current)) return;
    if (editing === undefined && calendar.settings.calendarId === "") {
      setError(t("settings.unavailable"));
      return;
    }
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
      const patch = editPatch();
      if (editing !== undefined && patch === null && !personal.changed) {
        onClose();
        return;
      }
      const result = await submitSave(patch, csrf);
      if (!result.ok) {
        setError(actionError(result.error.id, editing === undefined ? "create" : "save"));
        return;
      }
      // Cache refresh is secondary to the committed save, so retrying cannot duplicate it.
      await invalidate().catch(() => undefined);
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
          ? await deleteActivityAction({ id: editing.id, ...revision() }, readCsrfToken())
          : await completeActivityAction(
              {
                id: editing.id,
                done: !doneNow,
                ...revision(),
              },
              readCsrfToken(),
            );
      if (!result.ok) {
        setError(actionError(result.error.id, kind));
        return;
      }
      await invalidate().catch(() => undefined);
      onSaved?.();
      if (kind === "delete") onClose();
      else {
        if (result.version !== undefined) setVersion(result.version);
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
    calendar,
    personal,
    zone,
    setZone,
    t,
    S,
    attachFields,
    guard,
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
