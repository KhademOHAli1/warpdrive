"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ERROR_IDS } from "@/constants/errorIds";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { CalendarReminderDefaultsEditor } from "./CalendarReminderDefaultsEditor";
import type { CalendarReminderContext } from "./personalReminderSettings";
import { setCalendarReminderDefaultsAction } from "./reminderSettingsActions";

export interface CalendarReminderDefaultsPanelProps {
  calendarId: string;
  timeZone: string;
  disabled?: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onPendingChange: (pending: boolean) => void;
}
export function CalendarReminderDefaultsPanel(
  props: CalendarReminderDefaultsPanelProps,
): React.ReactNode {
  return <CalendarReminderDefaultsLoader key={props.calendarId} {...props} />;
}
function CalendarReminderDefaultsLoader(
  props: CalendarReminderDefaultsPanelProps,
): React.ReactNode {
  const t = useAppTranslations("calendar");
  const query = trpc.calendars.reminders.calendarDefaults.useQuery(
    { calendarId: props.calendarId },
    { staleTime: 0 },
  );
  const [initial, setInitial] = useState<CalendarReminderContext | null>(null);
  // A fresh read seeds this draft once. Background failures/refetches cannot replace user edits.
  if (initial === null && query.isFetchedAfterMount && !query.isError && query.data !== undefined)
    setInitial(query.data);
  if (initial !== null) return <CalendarReminderDefaultsForm {...props} initial={initial} />;
  if (query.isError)
    return (
      <div className="space-y-2 border-t pt-4">
        <p role="alert" className="text-sm text-destructive">
          {t("reminders.loadFailed")}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void query.refetch();
          }}
        >
          {t("editor.retry")}
        </Button>
      </div>
    );
  return (
    <p role="status" className="border-t pt-4 text-xs text-muted-foreground">
      {t("reminders.loading")}
    </p>
  );
}
function CalendarReminderDefaultsForm({
  initial,
  ...props
}: CalendarReminderDefaultsPanelProps & { initial: CalendarReminderContext }): React.ReactNode {
  const t = useAppTranslations("calendar");
  const utils = trpc.useUtils();
  const [baseline, setBaseline] = useState(initial);
  const [value, setValue] = useState(initial.defaults);
  const [raw, setRaw] = useState(false);
  const [valid, setValid] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const active = useRef(false);
  const dirty = raw || JSON.stringify(value) !== JSON.stringify(baseline.defaults);
  const { onDirtyChange, onPendingChange } = props;
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
      utils.calendars.reminders.calendarDefaults.invalidate({ calendarId: props.calendarId }),
      utils.calendars.list.invalidate(),
    ]);
  }
  async function save(): Promise<void> {
    if (active.current || props.disabled === true) return;
    if (!valid) {
      setError(t("reminders.needsReview"));
      return;
    }
    active.current = true;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const result = await setCalendarReminderDefaultsAction(
        { calendarId: props.calendarId, expectedRevision: baseline.revision, defaults: value },
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
      setValue(result.value.defaults);
      setSaved(true);
      // The action has committed. A cache refresh failure must not misreport a failed save.
      void refresh().catch(() => console.warn("calendar reminder cache refresh failed"));
    } catch {
      setError(t("reminders.saveFailed"));
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  return (
    <div className="space-y-2 border-t border-border/70 pt-4">
      <CalendarReminderDefaultsEditor
        value={value}
        onChange={(next) => {
          setValue(next);
          setSaved(false);
        }}
        timeZone={props.timeZone}
        emailCapability={baseline.emailCapability}
        disabled={pending || props.disabled === true}
        error={error}
        onRawChange={setRaw}
        onValidityChange={setValid}
      />
      {(dirty || pending || error !== null) && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending || props.disabled === true}
          onClick={() => {
            void save();
          }}
        >
          {t(pending ? "reminders.saving" : "reminders.saveDefaults")}
        </Button>
      )}
      {saved && (
        <p role="status" className="text-xs text-success">
          {t("reminders.savedDefaults")}
        </p>
      )}
    </div>
  );
}
