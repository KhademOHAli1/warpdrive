"use client";
import { CalendarDays, CheckCircle2, Clock3 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Tip } from "@/components/ui/tooltip";
import { ActivityTimeZoneHint } from "./ActivityTimeZoneHint";
import { CalendarEventActions } from "./CalendarEventActions";
import { CalendarEventCrmDisclosure } from "./CalendarEventCrmDisclosure";
import { CalendarEventDetails } from "./CalendarEventDetails";
import { CalendarEventOwnership } from "./CalendarEventOwnership";
import { CalendarEventSchedule } from "./CalendarEventSchedule";
import { CalendarEventTimeZone } from "./CalendarEventTimeZone";
import { CalendarEventViewer } from "./CalendarEventViewer";
import { CalendarReminderEditor } from "./CalendarReminderEditor";
import { type CalendarEventDialogProps, useCalendarEventEditor } from "./useCalendarEventEditor";

// Secondary controls reveal inline without widening the form or replacing its draft.
export function CalendarEventDialog(props: CalendarEventDialogProps): React.ReactNode {
  if (props.editing?.canEdit === false)
    return <CalendarEventViewer event={props.editing} onClose={props.onClose} />;
  return <CalendarEventEditor {...props} />;
}

function CalendarEventEditor(props: CalendarEventDialogProps): React.ReactNode {
  const {
    preferences,
    calendar,
    personal,
    zone,
    setZone,
    t,
    S,
    attachFields,
    guard,
    types,
    draft,
    value,
    pending,
    doneNow,
    error,
    change,
    allDay,
    save,
    manage,
    moveStart,
  } = useCalendarEventEditor(props);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) guard.requestClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        dir={preferences.locale === "fa" ? "rtl" : "ltr"}
        className="flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden border-border/80 bg-card p-0 sm:max-w-2xl"
      >
        <DialogHeader className="relative shrink-0 border-b border-border/70 px-6 py-4 pe-24">
          <DialogTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden />
            {t(props.editing === undefined ? "editor.create" : "editor.edit")}
            {doneNow && (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="size-3" aria-hidden />
                {t("completed")}
              </span>
            )}
          </DialogTitle>
          {props.editing !== undefined && (
            <div className="absolute end-12 top-1.5">
              <CalendarEventActions
                done={doneNow}
                pending={pending}
                onManage={(kind) => {
                  void manage(kind);
                }}
              />
            </div>
          )}
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          onKeyDown={(event) => {
            if (
              event.defaultPrevented ||
              event.key !== "Enter" ||
              (!event.ctrlKey && !event.metaKey)
            )
              return;
            event.preventDefault();
            const form = event.currentTarget;
            // TimePicker commits on Enter. Dispatch after that state update so shortcuts use
            // the visible clock value rather than the preceding render's canonical value.
            queueMicrotask(() => {
              if (form.isConnected) form.requestSubmit();
            });
          }}
        >
          {/* Anchor Radix's hidden select inputs inside the scroll body so focusing lower
              controls cannot scroll the outer dialog and move its header or footer. */}
          <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
            <fieldset
              ref={attachFields}
              disabled={pending}
              aria-busy={pending}
              inert={pending}
              className="min-w-0 disabled:opacity-70"
            >
              <section
                aria-label={t("editor.eventDetails")}
                className="min-w-0 space-y-4 px-4 py-4 sm:px-6"
              >
                <Input
                  autoFocus
                  dir={
                    draft.subject === "" ? (preferences.locale === "fa" ? "rtl" : "ltr") : "auto"
                  }
                  aria-label={t("editor.eventTitle")}
                  value={draft.subject}
                  maxLength={255}
                  onChange={(event) => change({ subject: event.target.value })}
                  placeholder={t("editor.titlePlaceholder")}
                  className="-ms-1 h-auto rounded-md border-transparent bg-transparent px-1 py-1.5 text-2xl font-semibold shadow-none hover:border-transparent focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-primary/25 md:text-2xl"
                />
                <section aria-label={t("editor.dateAndTime")} className="flex gap-3">
                  <Clock3 className="mt-6 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1 space-y-1">
                    <CalendarEventSchedule
                      draft={draft}
                      onStart={moveStart}
                      onEnd={({ date, time }) => change({ endDate: date, endTime: time })}
                      onAllDay={allDay}
                    />
                    <CalendarEventTimeZone
                      value={zone}
                      onChange={setZone}
                      compact
                      reveal={error === t("editor.invalidWallTime")}
                    />
                    {(draft.startTime !== "" ||
                      (props.editing?.allDay === true && props.editing.dueDate == null)) && (
                      <ActivityTimeZoneHint
                        hideSummary
                        timeZone={zone}
                        date={draft.startDate}
                        time={draft.startTime}
                        originalInstant={props.editing?.dueAt}
                        legacy={props.editing?.allDay === true && props.editing.dueDate == null}
                      />
                    )}
                  </div>
                </section>
                <CalendarEventDetails draft={draft} expanded={false} onChange={change} />
                <CalendarEventOwnership
                  settings={calendar.settings}
                  calendars={calendar.calendars}
                  legacy={props.editing !== undefined && props.editing.calendarId == null}
                  reveal={error === t("settings.unavailable")}
                  onChange={(patch) => {
                    calendar.change(patch);
                    if (props.editing === undefined && patch.calendarId !== undefined) {
                      const source = calendar.calendars.find((c) => c.id === patch.calendarId);
                      if (source !== undefined) setZone(source.timeZone);
                    }
                  }}
                />
                <CalendarReminderEditor
                  value={personal.selection}
                  defaults={personal.defaults}
                  allDay={draft.startTime === ""}
                  timeZone={zone}
                  emailCapability={personal.emailCapability}
                  onChange={personal.setSelection}
                  onRawChange={personal.setRawChanged}
                  onValidityChange={personal.setValid}
                  reveal={personal.reveal}
                  error={personal.reveal ? t("reminders.needsReview") : null}
                />
                <CalendarEventCrmDisclosure
                  draft={value}
                  types={types}
                  editing={props.editing}
                  onChange={change}
                  reveal={error === t("editor.typeUnavailable")}
                />
                {error !== null && (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm leading-relaxed text-destructive"
                  >
                    {error}
                  </p>
                )}
              </section>
            </fieldset>
          </div>
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border/70 bg-card px-4 py-3 sm:px-6">
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" disabled={pending} onClick={guard.requestClose}>
                {S.cancel}
              </Button>
              <Tip label={t("editor.saveShortcut")}>
                <Button type="submit" disabled={pending} className="min-w-24">
                  {pending ? S.saving : S.save}
                </Button>
              </Tip>
            </div>
          </footer>
        </form>
      </DialogContent>
      <ConfirmDialog
        open={guard.open}
        onOpenChange={guard.setOpen}
        title={t("editor.discardTitle")}
        description={t("editor.discardBody")}
        confirmLabel={t("editor.discard")}
        cancelLabel={t("editor.keepEditing")}
        destructive
        onConfirm={guard.discard}
      />
    </Dialog>
  );
}
