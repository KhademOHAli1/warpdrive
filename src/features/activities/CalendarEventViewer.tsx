"use client";
import { CalendarDays, Clock3, ExternalLink, MapPin, Video } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatTimeInput } from "@/components/ui/timeFormat";
import { sanitizeAuthorHtml } from "@/features/email/sanitizeHtml";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { safeMeetingLink } from "./CalendarMeetingField";
import { CalendarPersonalRemindersPanel } from "./CalendarPersonalRemindersPanel";
import { calendarEventDraft } from "./calendarEventDraft";
import { formatCalendarDate } from "./calendarSystem";
import { anchorDate } from "./calendarView";
import type { EditableActivity } from "./getForEdit";
import { useCalendarNavigationGuard } from "./useCalendarNavigationGuard";

export function CalendarEventViewer({
  event,
  onClose,
}: {
  event: EditableActivity;
  onClose: () => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const prefs = useLocalePreferences();
  const [reminderDirty, setReminderDirty] = useState(false);
  const [reminderPending, setReminderPending] = useState(false);
  const guard = useCalendarNavigationGuard(reminderDirty, reminderPending);
  const zone = event.eventTimeZone ?? prefs.timeZone;
  const draft = calendarEventDraft({ editing: event, timeZone: zone });
  const meeting = safeMeetingLink(event.videoCallUrl ?? "");
  const dateLabel = (date: string) =>
    date === "" ? "" : formatCalendarDate(anchorDate(date), prefs, { dateStyle: "full" });
  const clock = (value: string) => formatTimeInput(value, prefs.locale, prefs.numberingSystem);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) guard.navigate(onClose);
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        dir={prefs.locale === "fa" ? "rtl" : "ltr"}
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogHeader className="shrink-0 border-b px-6 py-5 pe-12">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden />
            {t("editor.readOnly")}
          </p>
          <DialogTitle className="pt-2 text-2xl" dir="auto">
            {event.subject}
          </DialogTitle>
        </DialogHeader>
        <div className="relative min-h-0 space-y-6 overflow-y-auto p-6">
          <div className="flex gap-3">
            <Clock3 className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <dl className="grid flex-1 gap-4 sm:grid-cols-2">
              {[
                ["editor.start", draft.startDate, draft.startTime],
                ["editor.end", draft.endDate, draft.endTime],
              ].map(([label, date, time]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">
                    {t(label as "editor.start" | "editor.end")}
                  </dt>
                  <dd className="mt-1 text-sm">
                    {dateLabel(date ?? "")}
                    <span className="ms-2 tabular-nums">
                      {time === "" ? t("allDay") : clock(time ?? "")}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          {draft.startTime !== "" && (
            <p className="text-xs text-muted-foreground">
              {t("editor.eventTimeZone")}: <bdi dir="ltr">{zone}</bdi>
            </p>
          )}
          {event.location !== null && event.location !== "" && (
            <p className="flex gap-3 text-sm">
              <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <bdi dir="auto">{event.location}</bdi>
            </p>
          )}
          {meeting !== null && (
            <a
              href={meeting.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3 text-sm hover:bg-accent"
            >
              <Video className="size-4" aria-hidden />
              {t("editor.joinMeeting")}
              <ExternalLink className="ms-auto size-3.5" aria-hidden />
            </a>
          )}
          {event.note !== null && event.note !== "" && (
            <section className="space-y-2">
              <h3 className="text-sm font-medium">{t("editor.description")}</h3>
              <div
                className="rounded-lg border p-4 text-sm leading-relaxed [&_a]:text-link [&_a]:underline"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized again at this read-only rendering boundary
                dangerouslySetInnerHTML={{ __html: sanitizeAuthorHtml(event.note) }}
              />
            </section>
          )}
          {event.personalReminders !== undefined && (
            <CalendarPersonalRemindersPanel
              key={event.id}
              activityId={event.id}
              allDay={event.allDay}
              initial={event.personalReminders}
              onDirtyChange={setReminderDirty}
              onPendingChange={setReminderPending}
            />
          )}
        </div>
        <footer className="flex shrink-0 justify-end border-t px-6 py-3">
          <Button
            variant="outline"
            disabled={reminderPending}
            onClick={() => guard.navigate(onClose)}
          >
            {t("editor.close")}
          </Button>
        </footer>
      </DialogContent>
      <ConfirmDialog
        open={guard.open}
        onOpenChange={guard.setOpen}
        title={t("editor.discardTitle")}
        description={t("editor.discardBody")}
        confirmLabel={t("editor.discard")}
        cancelLabel={t("editor.keepEditing")}
        destructive
        onConfirm={guard.confirm}
      />
    </Dialog>
  );
}
