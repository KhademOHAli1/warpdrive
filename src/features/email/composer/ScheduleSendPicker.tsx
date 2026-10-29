"use client";

import { useRef, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";
import { reportTimePickerValidity } from "@/components/ui/timePickerValidity";
import type { EmailMessages } from "@/features/email/emailMessages";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { instantParts } from "@/lib/zonedDateTime";
import {
  futureScheduledSendTime,
  type ScheduledSendDraft,
  type ScheduleTimeError,
  scheduledSendTime,
} from "./scheduledSendTime";

function scheduleError(error: ScheduleTimeError, messages: EmailMessages): string {
  switch (error) {
    case "incomplete":
      return messages._extra.scheduleIncomplete;
    case "invalid":
      return messages._extra.scheduleInvalid;
    case "nonexistent":
      return messages._extra.scheduleNonexistent;
    case "past":
      return messages._composer.scheduledPastMessage;
  }
}

export function ScheduleSendPicker({
  open,
  disabled,
  onScheduled,
  onClose,
}: {
  open: boolean;
  disabled: boolean;
  onScheduled?: (at: Date) => void;
  onClose: () => void;
}): React.ReactNode {
  const E = useEmailMessages();
  const preferences = useLocalePreferences();
  const [draft, setDraft] = useState<ScheduledSendDraft | null>(null);
  const [error, setError] = useState<ScheduleTimeError | null>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  if (!open) return null;
  // Once editing starts, changing a preference must not reinterpret the chosen send time.
  const active = draft ?? {
    date: instantParts(new Date(), preferences.timeZone).date,
    time: "",
    timeZone: preferences.timeZone,
  };
  const preview = scheduledSendTime(active);
  const update = (patch: Partial<Pick<ScheduledSendDraft, "date" | "time">>): void => {
    setDraft({ ...active, ...patch });
    setError(null);
  };
  const handleSchedule = (): void => {
    if (disabled || onScheduled === undefined) return;
    if (!reportTimePickerValidity(fieldsRef.current)) return;
    const result = futureScheduledSendTime(active);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onScheduled(result.value.at);
    setDraft(null);
    setError(null);
    onClose();
  };
  return (
    <div ref={fieldsRef} className="mt-1 flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <DatePicker
          ariaLabel={E._extra.scheduleDate}
          value={active.date === "" ? null : active.date}
          onChange={(date) => update({ date: date ?? "" })}
        />
        <TimePicker
          ariaLabel={E._extra.scheduleTime}
          value={active.time}
          onChange={(time) => update({ time })}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={handleSchedule}
          className="ms-1 rounded-md bg-action px-2 py-1 text-sm text-action-foreground transition-transform hover:opacity-90 active:scale-[0.96] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {E._extra.schedule}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {E._extra.scheduleTimeZone(`\u2066${active.timeZone}\u2069`)}
      </p>
      {preview.ok && (
        <p className="text-xs text-muted-foreground">
          {preview.value.ambiguous
            ? E._extra.scheduleAmbiguousTime(`\u2066UTC${preview.value.offset}\u2069`)
            : E._extra.scheduleUtcOffset(`\u2066UTC${preview.value.offset}\u2069`)}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-destructive">
          {scheduleError(error, E)}
        </p>
      )}
    </div>
  );
}
