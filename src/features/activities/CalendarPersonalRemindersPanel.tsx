"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ERROR_IDS } from "@/constants/errorIds";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { CalendarReminderEditor } from "./CalendarReminderEditor";
import type { EventReminderContext } from "./personalReminderSettings";
import { setEventReminderSettingsAction } from "./reminderSettingsActions";

export function CalendarPersonalRemindersPanel({
  activityId,
  allDay,
  initial,
  onDirtyChange,
  onPendingChange,
}: {
  activityId: string;
  allDay: boolean;
  initial: EventReminderContext;
  onDirtyChange: (dirty: boolean) => void;
  onPendingChange: (pending: boolean) => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const utils = trpc.useUtils();
  const [baseline, setBaseline] = useState(initial);
  const [value, setValue] = useState(initial.selection);
  const [raw, setRaw] = useState(false);
  const [valid, setValid] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const active = useRef(false);
  const dirty = raw || JSON.stringify(value) !== JSON.stringify(baseline.selection);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onPendingChange(pending);
  }, [pending, onPendingChange]);
  useEffect(
    () => () => {
      onDirtyChange(false);
      onPendingChange(false);
    },
    [onDirtyChange, onPendingChange],
  );
  async function refresh(): Promise<void> {
    await Promise.all([
      utils.calendars.reminders.eventSettings.invalidate({ activityId }),
      utils.activities.getForEdit.invalidate({ id: activityId }),
    ]);
  }
  async function save(): Promise<void> {
    if (active.current) return;
    if (!valid) {
      setError(t("reminders.needsReview"));
      return;
    }
    active.current = true;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const result = await setEventReminderSettingsAction(
        { activityId, expectedRevision: baseline.revision, selection: value },
        readCsrfToken(),
      );
      if (!result.ok) {
        setError(
          t(
            result.error.id === ERROR_IDS.ACTIVITY_CONFLICT
              ? "reminders.conflict"
              : "reminders.saveFailed",
          ),
        );
        return;
      }
      setBaseline(result.value);
      setValue(result.value.selection);
      setSaved(true);
      void refresh().catch(() => console.warn("personal reminder cache refresh failed"));
    } catch {
      setError(t("reminders.saveFailed"));
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  return (
    <div className="space-y-2 border-t border-border/70 pt-4">
      <CalendarReminderEditor
        value={value}
        defaults={baseline.defaults}
        allDay={allDay}
        timeZone={baseline.timeZone}
        emailCapability={baseline.emailCapability}
        onChange={(next) => {
          setValue(next);
          setSaved(false);
        }}
        disabled={pending}
        error={error}
        onRawChange={setRaw}
        onValidityChange={setValid}
      />
      {(dirty || pending || error !== null) && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            void save();
          }}
        >
          {t(pending ? "reminders.saving" : "reminders.savePersonal")}
        </Button>
      )}
      {saved && (
        <p role="status" className="text-xs text-success">
          {t("reminders.savedPersonal")}
        </p>
      )}
    </div>
  );
}
