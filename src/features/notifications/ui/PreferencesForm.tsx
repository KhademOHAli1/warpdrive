"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import type { NotificationType } from "@/constants/notificationTypes";
import { NOTIFICATION_TYPES } from "@/constants/notificationTypes";
import { useMessages } from "@/features/i18n/LocaleProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";

export type NotificationPreference = { inApp: boolean; email: boolean };
export type NotificationPreferences = Record<NotificationType, NotificationPreference>;
export type PreferenceSaveFeedback = "saving" | "saved" | "error";

type ToggleProps = {
  event: string;
  channel: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
};

function Toggle({ event, channel, checked, disabled, onChange }: ToggleProps) {
  const id = useId();
  return (
    <span className="flex min-w-0 items-center justify-between gap-3 text-sm select-none md:justify-center">
      <label htmlFor={id} className="cursor-pointer text-muted-foreground md:sr-only">
        {channel}
      </label>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        label={`${event}: ${channel}`}
      />
    </span>
  );
}

function PreferenceRow({
  type,
  pref,
  feedback,
  onChange,
  onRetry,
}: {
  type: NotificationType;
  pref: NotificationPreference;
  feedback?: PreferenceSaveFeedback;
  onChange: (next: NotificationPreference) => void;
  onRetry?: () => void;
}) {
  const id = useId();
  const messages = useMessages();
  const L = useSettingsMessages();
  const { columnInApp, columnEmail, typeLabels } = messages.notifications.preferences;
  const saving = feedback === "saving";

  return (
    <fieldset
      aria-labelledby={id}
      aria-busy={saving}
      data-testid="pref-row"
      className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 py-4 md:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] md:items-center"
    >
      <span id={id} className="col-span-2 min-w-0 break-words text-sm font-medium md:col-span-1">
        {typeLabels[type]}
      </span>
      <Toggle
        event={typeLabels[type]}
        channel={columnInApp}
        checked={pref.inApp}
        disabled={saving}
        onChange={(next) => onChange({ ...pref, inApp: next })}
      />
      <Toggle
        event={typeLabels[type]}
        channel={columnEmail}
        checked={pref.email}
        disabled={saving}
        onChange={(next) => onChange({ ...pref, email: next })}
      />
      {feedback !== undefined && (
        <div className="col-span-2 flex flex-wrap items-center gap-3 text-xs md:col-span-3">
          {feedback === "error" ? (
            <>
              <p role="alert" className="text-destructive">
                <span className="sr-only">{typeLabels[type]}: </span>
                {L._extra.notificationSaveError}
              </p>
              {onRetry !== undefined && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  {messages.boundaries.retry}
                </Button>
              )}
            </>
          ) : (
            <p role="status" className="text-muted-foreground">
              <span className="sr-only">{typeLabels[type]}: </span>
              {saving ? L._extra.saving : L.saved}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

export function PreferencesForm({
  prefs,
  onChange,
  feedback = {},
  onRetry,
}: {
  prefs: NotificationPreferences;
  onChange: (type: NotificationType, next: NotificationPreference) => void;
  feedback?: Partial<Record<NotificationType, PreferenceSaveFeedback>>;
  onRetry?: (type: NotificationType) => void;
}) {
  const { columnInApp, columnEmail } = useMessages().notifications.preferences;

  return (
    <div>
      <div
        aria-hidden="true"
        className="hidden grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-x-6 border-b py-3 text-center text-xs font-medium text-muted-foreground md:grid"
      >
        <span />
        <span>{columnInApp}</span>
        <span>{columnEmail}</span>
      </div>
      <div className="divide-y">
        {NOTIFICATION_TYPES.map((type) => (
          <PreferenceRow
            key={type}
            type={type}
            pref={prefs[type]}
            feedback={feedback[type]}
            onChange={(next) => onChange(type, next)}
            onRetry={onRetry === undefined ? undefined : () => onRetry(type)}
          />
        ))}
      </div>
    </div>
  );
}
