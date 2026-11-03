"use client";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TimePicker } from "@/components/ui/TimePicker";
import { ToggleField } from "@/components/ui/ToggleField";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { ActivityTimeZoneHint } from "./ActivityTimeZoneHint";
import type { ActivityReminderSelectionV1 } from "./reminderIntentTypes";
import type { ActivityReminderView } from "./reminderReadModel";

function statusKey(
  reminder: ActivityReminderView,
): "delivered" | "pending" | "eventFinished" | "cancelled" | "needsAttention" {
  if (reminder.status === "delivered") return "delivered";
  if (reminder.status === "pending") return "pending";
  if (reminder.outcomeReason === "event_finished") return "eventFinished";
  if (reminder.status === "cancelled") return "cancelled";
  return "needsAttention";
}
export function CalendarReminderFields({
  selection,
  date,
  timeZone,
  metadata,
  legacyWarning,
  changed,
  pending,
  onEnable,
  onTime,
  onRefresh,
  onRetry,
  dateConfirmation,
}: {
  selection: ActivityReminderSelectionV1 | null;
  date: string;
  timeZone: string;
  metadata: ActivityReminderView | null;
  legacyWarning: boolean;
  changed: boolean;
  pending: boolean;
  onEnable: (enabled: boolean) => void;
  onTime: (value: string) => void;
  onRefresh?: () => void;
  onRetry?: () => void;
  dateConfirmation?: { checked: boolean; onChange: (checked: boolean) => void };
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const enabled = selection !== null && selection.kind !== "none";
  return (
    <section aria-label={t("reminder.title")} className="space-y-3 border-t border-border/70 pt-4">
      <h3 className="flex items-center gap-3 text-sm font-medium">
        <Bell className="size-4 text-muted-foreground" aria-hidden />
        {t("reminder.title")}
      </h3>
      <ToggleField label={t("reminder.enable")} checked={enabled} onCheckedChange={onEnable} />
      {selection?.kind === "before_start" && (
        <p className="text-xs text-muted-foreground">{t("reminder.beforeStart")}</p>
      )}
      {selection?.kind === "all_day_at" && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{t("reminder.time")}</span>
            <div className="w-28">
              <TimePicker
                ariaLabel={t("reminder.time")}
                value={selection.localTime}
                onChange={onTime}
              />
            </div>
          </div>
          <ActivityTimeZoneHint timeZone={timeZone} date={date} time={selection.localTime} />
        </div>
      )}
      {selection === null && (
        <p className="text-xs text-muted-foreground">{t("reminder.legacy")}</p>
      )}
      {legacyWarning && (
        <p className="text-xs text-muted-foreground">{t("reminder.priorDelivery")}</p>
      )}
      {dateConfirmation !== undefined && (
        <ToggleField
          label={t("reminder.authorDate", { zone: timeZone })}
          checked={dateConfirmation.checked}
          onCheckedChange={dateConfirmation.onChange}
          className="text-xs"
        />
      )}
      {changed && <p className="text-xs text-muted-foreground">{t("reminder.saveChanges")}</p>}
      {!changed && metadata !== null && (
        <p role="status" className="text-xs text-muted-foreground">
          {t(`reminder.${statusKey(metadata)}`)}
        </p>
      )}
      {onRefresh !== undefined && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={pending} onClick={onRefresh}>
            {t("reminder.refresh")}
          </Button>
          {!changed && metadata?.retryable === true && onRetry !== undefined && (
            <Button size="sm" variant="outline" disabled={pending} onClick={onRetry}>
              {t("reminder.retry")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
