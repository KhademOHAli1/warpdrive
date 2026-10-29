"use client";
import type React from "react";
import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, type SelectOption } from "@/components/ui/Select";
import { TimePicker } from "@/components/ui/TimePicker";
import { reportTimePickerValidity } from "@/components/ui/timePickerValidity";
import { ACTIVITY_PRIORITY_KEYS } from "@/constants/activityPriorities";
import { FIELD_INPUT as FIELD } from "@/constants/formStyles";
import {
  useAppTranslations,
  useLocale,
  useLocalePreferences,
} from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { ActivityDatePicker } from "./ActivityDatePicker";
import { ActivityTimeZoneHint } from "./ActivityTimeZoneHint";
import { ActivityTypeIcon } from "./ActivityTypeIcon";
import { completeActivityAction, deleteActivityAction, editActivityAction } from "./actions";
import { buildActivityPatch, type EditableActivity, isoToLocalParts } from "./activityEditPatch";
import { localizeActivityTypes } from "./activityTypeLabels";
import { useActivitiesMessages } from "./useActivitiesMessages";
import { useInvalidateActivityLists } from "./useInvalidateActivityLists";

export type { EditableActivity } from "./activityEditPatch";

interface Props {
  activity: EditableActivity;
  onClose: () => void;
  onSaved?: () => void;
  onMarkedDone?: (activityId: string) => void;
}

export function ActivityEditModal({
  activity,
  onClose,
  onSaved,
  onMarkedDone,
}: Props): React.ReactNode {
  const S = useActivitiesMessages();
  const locale = useLocale();
  const preferences = useLocalePreferences();
  const [draftZone] = useState(preferences.timeZone);
  const tCalendar = useAppTranslations("calendar");
  const fieldsRef = useRef<HTMLDivElement>(null);
  const typesQ = trpc.activities.listTypes.useQuery();
  const invalidateActivityLists = useInvalidateActivityLists();
  const types = localizeActivityTypes(typesQ.data ?? [], locale);
  const initialParts = isoToLocalParts(
    activity.dueAtIso,
    activity.allDay,
    draftZone,
    activity.dueDate,
  );

  const [typeId, setTypeId] = useState(activity.typeId);
  // Guard against ActivitiesTable.toEditable opening this modal with typeId: "" (row clicked
  // before its own listTypes resolved). Mirrors AddActivityModal's effectiveTypeId: display-only
  // fallback so the Select never shows blank when types are available. Save still diffs against
  // the raw typeId, so an untouched fallback selection never gets written as a spurious patch.
  const effectiveTypeId = typeId === "" ? (types[0]?.id ?? "") : typeId;
  const [subject, setSubject] = useState(activity.subject);
  const [priority, setPriority] = useState(activity.priority ?? "");
  const [date, setDate] = useState(initialParts.date);
  const [time, setTime] = useState(initialParts.time);
  const [location, setLocation] = useState(activity.location ?? "");
  const [doneNow, setDoneNow] = useState(activity.done);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(): Promise<void> {
    if (!reportTimePickerValidity(fieldsRef.current)) return;
    if (subject.trim() === "") {
      setError(S.subjectRequired);
      return;
    }
    let patch: ReturnType<typeof buildActivityPatch>;
    try {
      patch = buildActivityPatch(
        activity,
        { subject, typeId, priority, date, time, location },
        draftZone,
      );
    } catch {
      setError(tCalendar("invalidWallTime"));
      return;
    }
    if (patch === null) {
      onClose();
      return;
    }
    setPending(true);
    setError(null);
    const r = await editActivityAction(patch, readCsrfToken());
    if (!r.ok) {
      setPending(false);
      setError(S.saveFailed(r.error.id));
      return;
    }
    await invalidateActivityLists();
    setPending(false);
    onSaved?.();
    onClose();
  }

  async function remove(): Promise<void> {
    setPending(true);
    setError(null);
    const r = await deleteActivityAction({ id: activity.id }, readCsrfToken());
    if (!r.ok) {
      setPending(false);
      setError(S.deleteFailed(r.error.id));
      return;
    }
    await invalidateActivityLists();
    setPending(false);
    onSaved?.();
    onClose();
  }

  async function toggleDone(): Promise<void> {
    const next = !doneNow;
    setPending(true);
    setError(null);
    const r = await completeActivityAction({ id: activity.id, done: next }, readCsrfToken());
    if (!r.ok) {
      setPending(false);
      setError(S.updateFailed(r.error.id));
      return;
    }
    await invalidateActivityLists();
    setPending(false);
    setDoneNow(next);
    onSaved?.();
    if (next) onMarkedDone?.(activity.id);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-w-md gap-0 overflow-hidden bg-card p-0"
      >
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="text-base font-semibold">{S.editActivity}</DialogTitle>
        </DialogHeader>

        <div ref={fieldsRef} className="flex flex-col gap-3 px-5 py-4 text-sm">
          <div className="block">
            <span className="mb-1 block font-medium">{S.type}</span>
            <Select
              ariaLabel={S.activityType}
              value={effectiveTypeId}
              onChange={setTypeId}
              options={types.map<SelectOption>((t) => ({
                value: t.id,
                label: t.name,
                icon: <ActivityTypeIcon typeKey={t.key} />,
              }))}
            />
          </div>
          <label className="block">
            <span className="mb-1 block font-medium">{S.subject}</span>
            <input
              aria-label={S.subject}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={FIELD}
            />
          </label>
          <div className="block">
            <span className="mb-1 block font-medium">{S.priority}</span>
            <Select
              ariaLabel={S.priority}
              value={priority}
              onChange={setPriority}
              placeholder={S.noPriority}
              options={[
                { value: "", label: S.noPriority },
                ...ACTIVITY_PRIORITY_KEYS.map<SelectOption>((k) => ({
                  value: k,
                  label: S.priorities[k],
                })),
              ]}
            />
          </div>
          <div className="block">
            <span className="mb-1 block font-medium">{S.dueDate}</span>
            <ActivityDatePicker
              ariaLabel={S.dueDate}
              value={date === "" ? null : date}
              onChange={(v) => setDate(v ?? "")}
              assigneeId={activity.assigneeId ?? null}
            />
          </div>
          <div className="block">
            <span className="mb-1 block font-medium">{S.startTime}</span>
            <TimePicker ariaLabel={S.startTime} value={time} onChange={setTime} />
          </div>
          <ActivityTimeZoneHint
            originalInstant={activity.dueAtIso}
            timeZone={draftZone}
            date={date}
            time={time}
            legacy={activity.allDay && (activity.dueDate == null || activity.dueDate === "")}
          />
          <label className="block">
            <span className="mb-1 block font-medium">{S.location}</span>
            <input
              aria-label={S.location}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={S.addLocation}
              className={FIELD}
            />
          </label>

          {error !== null && (
            <p
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-700"
            >
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={pending}
              className="rounded-md border px-3 py-1.5 text-sm text-red-700 transition-transform hover:bg-red-50 active:not-disabled:scale-[0.96] disabled:opacity-50"
            >
              {S.delete}
            </button>
            <button
              type="button"
              onClick={() => void toggleDone()}
              disabled={pending}
              className="rounded-md border px-3 py-1.5 text-sm transition-transform hover:bg-accent active:not-disabled:scale-[0.96] disabled:opacity-50"
            >
              {doneNow ? S.reopen : S.markAsDone}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-3 py-1.5 text-sm transition-transform hover:bg-accent active:scale-[0.96]"
            >
              {S.cancel}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={pending}
              className="rounded-md bg-action px-4 py-1.5 text-sm font-medium text-action-foreground transition-transform hover:opacity-90 active:not-disabled:scale-[0.96] disabled:opacity-50"
            >
              {pending ? S.saving : S.save}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
