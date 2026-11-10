"use client";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { CalendarEventTimeZone } from "./CalendarEventTimeZone";
import { CalendarMembersEditor } from "./CalendarMembersEditor";
import { setCalendarArchivedAction, updateCalendarAction } from "./calendarActions";
import type { CalendarMutationResult } from "./useCalendarMutation";
export function CalendarSettingsForm({
  calendar,
  run,
  onChanged,
  onArchived,
  onDirtyChange,
}: {
  calendar: { id: string; name: string; timeZone: string; isPrimary: boolean; ownerId: string };
  run: (work: () => Promise<CalendarMutationResult>) => Promise<void>;
  onChanged: () => Promise<void>;
  onArchived?: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const locale = useLocale();
  const [name, setName] = useState(calendar.name);
  const [timeZone, setTimeZone] = useState(calendar.timeZone);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-6">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const result = await updateCalendarAction(
              { id: calendar.id, ...(name.trim() === "" ? {} : { name }), timeZone },
              readCsrfToken(),
            );
            if (result.ok) await onChanged();
            return result;
          });
        }}
      >
        <div className="space-y-2">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor={`calendar-name-${calendar.id}`}
          >
            {t("settings.name")}
          </label>
          <Input
            id={`calendar-name-${calendar.id}`}
            dir={name === "" ? (locale === "fa" ? "rtl" : "ltr") : "auto"}
            value={name}
            placeholder={t("settings.personal")}
            maxLength={100}
            onChange={(event) => {
              setName(event.target.value);
              onDirtyChange(event.target.value !== calendar.name || timeZone !== calendar.timeZone);
            }}
          />
        </div>
        <CalendarEventTimeZone
          value={timeZone}
          onChange={(next) => {
            setTimeZone(next);
            onDirtyChange(name !== calendar.name || next !== calendar.timeZone);
          }}
          label={t("settings.timeZone")}
          hint={t("settings.timeZoneHint")}
        />
        <Button type="submit" variant="outline">
          {t("settings.save")}
        </Button>
      </form>
      <CalendarMembersEditor calendarId={calendar.id} ownerId={calendar.ownerId} run={run} />
      {!calendar.isPrimary && (
        <div className="border-t pt-5">
          <Button variant="ghost" className="text-destructive" onClick={() => setConfirm(true)}>
            {t("settings.archive")}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("settings.archiveTitle")}
        description={t("settings.archiveBody")}
        confirmLabel={t("settings.archive")}
        onConfirm={() => {
          void run(async () => {
            const result = await setCalendarArchivedAction(
              { id: calendar.id, archived: true },
              readCsrfToken(),
            );
            if (result.ok) await (onArchived ?? onChanged)();
            return result;
          });
        }}
      />
    </div>
  );
}
