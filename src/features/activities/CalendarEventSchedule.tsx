"use client";
import { TimePicker } from "@/components/ui/TimePicker";
import { ToggleField } from "@/components/ui/ToggleField";
import type { ActivityDraft } from "@/features/deal-workspace/composer/composerHelpers";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { ActivityDatePicker } from "./ActivityDatePicker";

export function CalendarEventSchedule({
  draft,
  onStart,
  onEnd,
  onAllDay,
}: {
  draft: ActivityDraft;
  onStart: (next: { date: string; time: string }) => void;
  onEnd: (next: { date: string; time: string }) => void;
  onAllDay: (enabled: boolean) => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const allDay = draft.startTime === "";
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("editor.start")}</span>
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <ActivityDatePicker
                assigneeId={draft.ownerId || null}
                ariaLabel={t("editor.startDate")}
                value={draft.startDate || null}
                onChange={(date) => onStart({ date: date ?? "", time: draft.startTime })}
              />
            </div>
            {!allDay && (
              <div className="w-28 shrink-0">
                <TimePicker
                  ariaLabel={t("editor.startTime")}
                  value={draft.startTime}
                  onChange={(time) => onStart({ date: draft.startDate, time })}
                />
              </div>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("editor.end")}</span>
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <ActivityDatePicker
                assigneeId={draft.ownerId || null}
                ariaLabel={t("editor.endDate")}
                value={draft.endDate || null}
                onChange={(date) => onEnd({ date: date ?? "", time: draft.endTime })}
              />
            </div>
            {!allDay && (
              <div className="w-28 shrink-0">
                <TimePicker
                  ariaLabel={t("editor.endTime")}
                  value={draft.endTime}
                  onChange={(time) => onEnd({ date: draft.endDate, time })}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <ToggleField
        label={t("allDay")}
        checked={allDay}
        onCheckedChange={onAllDay}
        className="text-xs text-muted-foreground"
      />
    </div>
  );
}
