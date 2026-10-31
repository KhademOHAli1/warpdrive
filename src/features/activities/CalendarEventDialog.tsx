"use client";
import { CalendarDays } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { reportTimePickerValidity } from "@/components/ui/timePickerValidity";
import {
  type ActivityDraft,
  buildActivityInput,
} from "@/features/deal-workspace/composer/composerHelpers";
import { TypeIconRail } from "@/features/deal-workspace/composer/TypeIconRail";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { instantCivilDate } from "@/lib/zonedDateTime";
import { readCsrfToken } from "@/utils/csrfCookie";
import { ActivityTimeZoneHint } from "./ActivityTimeZoneHint";
import {
  completeActivityAction,
  createActivityAction,
  deleteActivityAction,
  editActivityAction,
} from "./actions";
import { localizeActivityTypes } from "./activityTypeLabels";
import { CalendarEventDetails } from "./CalendarEventDetails";
import { CalendarEventSchedule } from "./CalendarEventSchedule";
import {
  calendarEventDraft,
  calendarEventIssue,
  calendarEventPatch,
  moveCalendarStart,
} from "./calendarEventDraft";
import type { EditableActivity } from "./getForEdit";
import { useActivitiesMessages } from "./useActivitiesMessages";
import { useInvalidateActivityLists } from "./useInvalidateActivityLists";

interface Props {
  defaultDate?: string;
  defaultTime?: string;
  editing?: EditableActivity;
  onClose: () => void;
  onSaved?: () => void;
  onMarkedDone?: (id: string) => void;
}

// One draft survives compact/detail transitions. The current activity service remains the
// permission/CSRF/sanitization boundary; this editor does not claim invitation or sync delivery.
export function CalendarEventDialog({
  defaultDate,
  defaultTime = "",
  editing,
  onClose,
  onSaved,
  onMarkedDone,
}: Props): React.ReactNode {
  const preferences = useLocalePreferences();
  const [zone] = useState(preferences.timeZone);
  const t = useAppTranslations("calendar");
  const S = useActivitiesMessages();
  const fields = useRef<HTMLFieldSetElement>(null);
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting.current) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="gap-0 overflow-hidden bg-card p-0 sm:max-w-2xl"
        dir={preferences.locale === "fa" ? "rtl" : "ltr"}
      >
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
            {t(editing === undefined ? "editor.create" : "editor.edit")}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset
            ref={fields}
            disabled={pending}
            aria-busy={pending}
            inert={pending}
            className="max-h-[min(72dvh,48rem)] space-y-5 overflow-y-auto px-6 py-5 disabled:opacity-70"
          >
            <Input
              autoFocus
              aria-label={S.subject}
              value={draft.subject}
              maxLength={255}
              onChange={(event) => change({ subject: event.target.value })}
              placeholder={t("editor.titlePlaceholder")}
              className="h-12 text-lg font-medium md:text-lg"
            />
            <TypeIconRail
              types={types}
              value={value.typeId}
              onChange={(typeId) => change({ typeId })}
            />
            <CalendarEventSchedule
              draft={draft}
              onStart={(next) =>
                setDraft((current) => moveCalendarStart(current, next, zone, editing))
              }
              onEnd={({ date, time }) => change({ endDate: date, endTime: time })}
              onAllDay={allDay}
            />
            <ActivityTimeZoneHint
              timeZone={zone}
              date={draft.startDate}
              time={draft.startTime}
              originalInstant={editing?.dueAt}
              legacy={editing?.allDay === true && editing.dueDate == null}
            />
            {details && <CalendarEventDetails draft={draft} onChange={change} />}
            {error !== null && (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-6 py-4">
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={details}
              disabled={pending}
              onClick={() => setDetails(!details)}
            >
              {t(details ? "editor.fewerOptions" : "editor.moreOptions")}
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              {editing !== undefined && (
                <>
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      void manage("delete");
                    }}
                  >
                    {S.delete}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      void manage("complete");
                    }}
                  >
                    {doneNow ? S.reopen : S.markAsDone}
                  </Button>
                </>
              )}
              <Button variant="outline" disabled={pending} onClick={onClose}>
                {S.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? S.saving : S.save}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
