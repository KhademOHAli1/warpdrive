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
import { localizeActivityTypes } from "./activityTypeLabels";
import type { AdvancedCalendarDraft } from "./CalendarAdvancedFields";
import {
  calendarEventDraft,
  calendarEventIssue,
  calendarEventPatch,
  moveCalendarStart,
} from "./calendarEventDraft";
import {
  completeCalendarEventAction,
  createCalendarEventAction,
  deleteCalendarEventAction,
  editCalendarEventAction,
  retryCalendarReminderAction,
} from "./calendarNativeActions";
import { mergeCalendarRefresh } from "./calendarReminderDraft";
import type { EditableActivity } from "./getForEdit";
import { resolveActivityReminderTime } from "./reminderTime";
import { useActivitiesMessages } from "./useActivitiesMessages";
import { useCalendarDraftGuard } from "./useCalendarDraftGuard";
import { useCalendarEventPersistence } from "./useCalendarEventPersistence";
import { useCalendarReminderEditor } from "./useCalendarReminderEditor";

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
  const initialZone =
    editing?.reminder == null
      ? (editing?.eventTimeZone ?? editing?.authoredTimeZone)
      : (editing.authoredTimeZone ?? editing.eventTimeZone);
  const [zone, setZone] = useState(initialZone ?? preferences.timeZone);
  const [advanced, setAdvanced] = useState<AdvancedCalendarDraft | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const onAdvancedChange = useCallback(
    (next: AdvancedCalendarDraft) =>
      setAdvanced((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next)),
    [],
  );
  const [baseline, setBaseline] = useState(editing);
  const t = useAppTranslations("calendar");
  const S = useActivitiesMessages();
  const fields = useRef<HTMLFieldSetElement>(null);
  const attachFields = useCallback((node: HTMLFieldSetElement | null) => {
    fields.current = node;
  }, []);
  const types = localizeActivityTypes(
    trpc.activities.listTypes.useQuery().data ?? [],
    preferences.locale,
  );
  const [draft, setDraft] = useState(() =>
    calendarEventDraft({
      date: defaultDate ?? instantCivilDate(new Date(), zone),
      time: defaultTime,
      endDate: defaultEndDate,
      endTime: defaultEndTime,
      editing,
      timeZone: zone,
    }),
  );
  const [details, setDetails] = useState(editing !== undefined);
  const [timed, setTimed] = useState({
    start: draft.startTime || "09:00",
    end: draft.endTime || "10:00",
  });
  const [doneNow, setDoneNow] = useState(editing?.done ?? false);
  const [errorState, setErrorState] = useState<{
    message: string;
    origin: "editor" | "read";
  } | null>(null);
  const setError = useCallback((message: string | null, origin: "editor" | "read" = "editor") => {
    setErrorState(message === null ? null : { message, origin });
  }, []);
  const error = errorState?.message ?? null;
  const [legacyDateConfirmed, setLegacyDateConfirmed] = useState(false);
  const reminder = useCalendarReminderEditor(editing, zone);
  const persistence = useCalendarEventPersistence({
    onClose,
    onSaved,
    onRead: (next) => {
      if (baseline !== undefined)
        setDraft((current) =>
          mergeCalendarRefresh(
            current,
            calendarEventDraft({ editing: baseline, timeZone: zone }),
            calendarEventDraft({ editing: next, timeZone: zone }),
          ),
        );
      setBaseline(next);
      setDoneNow(next.done);
      reminder.refresh(next);
      setErrorState((current) => (current?.origin === "read" ? null : current));
    },
    onConfirmed: (kind, id) => {
      setError(null);
      if (kind === "complete") {
        setDoneNow(!doneNow);
        setDraft((current) => ({ ...current, done: !doneNow }));
        if (!doneNow) onMarkedDone?.(id);
      }
    },
    onFailure: (kind, id) => {
      const origin = kind === "read" ? "read" : "editor";
      if (id === "E_ACTIVITY_010") setError(t("reminder.stale"), origin);
      else if (id === "E_ACTIVITY_009") setError(t("reminder.invalid"), origin);
      else if (kind === "read") setError(t("editor.loadFailed"), origin);
      else if (kind === "delete") setError(S.deleteFailed(id), origin);
      else if (kind === "save")
        setError(editing === undefined ? S.createFailed(id) : S.saveFailed(id), origin);
      else setError(S.updateFailed(id), origin);
    },
  });
  const [initialDraft] = useState(draft);
  const guard = useCalendarDraftGuard({
    draft,
    initial:
      baseline === undefined
        ? initialDraft
        : calendarEventDraft({ editing: baseline, timeZone: zone }),
    fields,
    pending: persistence.pending,
    onClose,
    extraChanged: advanced?.changed === true,
  });
  const calendarReminders = advanced?.patch.personalReminders !== undefined;
  const value = { ...draft, typeId: draft.typeId || (types[0]?.id ?? "") };
  const dateConfirmationRequired =
    baseline?.allDay === true &&
    baseline.dueDate == null &&
    draft.startTime === "" &&
    reminder.selection !== null &&
    reminder.selection.kind !== "none";
  function change(patch: Partial<ActivityDraft>): void {
    setDraft((current) => ({ ...current, ...patch }));
  }
  function allDay(enabled: boolean): void {
    reminder.eventKind(enabled);
    if (enabled) {
      setTimed({ start: draft.startTime, end: draft.endTime });
      change({ startTime: "", endTime: "" });
    } else change({ startTime: timed.start || "09:00", endTime: timed.end || "10:00" });
  }
  function validReminder(): boolean {
    if (!reminder.changed || reminder.selection === null) return true;
    const input = buildActivityInput(value, zone);
    const resolved = resolveActivityReminderTime(
      { ...input, reminderTimeZone: reminder.reminderZone },
      reminder.selection,
    );
    if (resolved.ok) return true;
    setError(t("reminder.invalid"));
    return false;
  }
  async function save(): Promise<void> {
    if (persistence.recovery !== null) {
      await persistence.recover();
      return;
    }
    if (!persistence.canEdit || persistence.pending || !reportTimePickerValidity(fields.current))
      return;
    const issue = calendarEventIssue(value, zone, baseline);
    if (issue !== null) {
      setError(t(`editor.${issue}`));
      return;
    }
    if (dateConfirmationRequired && !legacyDateConfirmed) {
      setError(t("reminder.dateConfirmationRequired"));
      return;
    }
    if (advanced !== null && !advanced.valid) {
      setError(t("settings.unavailable"));
      return;
    }
    if (!calendarReminders && !validReminder()) return;
    setError(null);
    const csrf = readCsrfToken();
    const identity = { v: 1, expectedActorId: persistence.actorId };
    if (baseline === undefined) {
      await persistence.mutate("save", () =>
        createCalendarEventAction(
          {
            ...identity,
            activity: {
              ...buildActivityInput(value, zone),
              authoredTimeZone: zone,
              ...(calendarReminders
                ? { ...advanced.patch }
                : {
                    reminder: reminder.selection ?? { kind: "none" },
                    reminderTimeZone: reminder.reminderZone,
                    ...advanced?.patch,
                  }),
              eventTimeZone: zone,
            },
          },
          csrf,
        ),
      );
      return;
    }
    const patch = calendarEventPatch(baseline, value, zone);
    if (patch === null && !reminder.changed && advanced?.changed !== true) {
      onClose();
      return;
    }
    const temporal =
      patch !== null &&
      (patch.dueAt !== undefined || patch.dueDate !== undefined || patch.allDay !== undefined);
    await persistence.mutate("save", () =>
      editCalendarEventAction(
        {
          ...identity,
          activity: {
            ...(patch ?? { id: baseline.id }),
            ...(calendarReminders ? {} : reminder.patch()),
            ...advanced?.patch,
            ...(temporal ? { authoredTimeZone: zone } : {}),
            ...(dateConfirmationRequired && legacyDateConfirmed
              ? {
                  allDay: true,
                  dueDate: value.startDate,
                  endDate: value.endDate || value.startDate,
                  authoredTimeZone: zone,
                }
              : {}),
            ...(baseline.version === undefined ? {} : { expectedVersion: baseline.version }),
            expectedReminderGeneration: reminder.metadata?.generationId ?? null,
          },
        },
        csrf,
      ),
    );
  }
  async function manage(kind: "delete" | "complete"): Promise<void> {
    if (baseline === undefined) return;
    setError(null);
    const identity = { v: 1, expectedActorId: persistence.actorId };
    await persistence.mutate(kind, () =>
      kind === "delete"
        ? deleteCalendarEventAction({ ...identity, activityId: baseline.id }, readCsrfToken())
        : completeCalendarEventAction(
            {
              ...identity,
              activity: { id: baseline.id, done: !doneNow, expectedVersion: baseline.version },
            },
            readCsrfToken(),
          ),
    );
  }
  async function retryReminder(): Promise<void> {
    if (baseline === undefined || reminder.metadata === null) return;
    setError(null);
    await persistence.mutate("retry", () =>
      retryCalendarReminderAction(
        {
          v: 1,
          expectedActorId: persistence.actorId,
          activityId: baseline.id,
          expectedGenerationId: reminder.metadata?.generationId,
        },
        readCsrfToken(),
      ),
    );
  }
  return {
    preferences,
    advancedOpen,
    advancedMounted: advancedOpen || advanced !== null,
    setAdvancedOpen,
    onAdvancedChange,
    setZone,
    guard,
    calendarReminders,
    zone,
    t,
    S,
    attachFields,
    canClose: persistence.canClose,
    types,
    draft,
    value,
    details,
    setDetails,
    pending: persistence.pending,
    doneNow,
    error,
    change,
    allDay,
    save,
    manage,
    canEdit: persistence.canEdit,
    recovery: persistence.recovery,
    actorMissing: persistence.actorId === null,
    reminder,
    retryReminder,
    dateConfirmation: dateConfirmationRequired
      ? { checked: legacyDateConfirmed, onChange: setLegacyDateConfirmed }
      : undefined,
    refreshReminder: baseline === undefined ? undefined : () => persistence.refresh(baseline.id),
    moveStart: (next: { date: string; time: string }) =>
      setDraft((current) => moveCalendarStart(current, next, zone, baseline)),
  };
}
