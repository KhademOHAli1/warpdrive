"use client";
import { CalendarDays, CheckCircle2, Clock3, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ActivityTimeZoneHint } from "./ActivityTimeZoneHint";
import { CalendarEventActions } from "./CalendarEventActions";
import { CalendarEventCrmDetails } from "./CalendarEventCrmDetails";
import { CalendarEventDetails } from "./CalendarEventDetails";
import { CalendarEventSchedule } from "./CalendarEventSchedule";
import { type CalendarEventDialogProps, useCalendarEventEditor } from "./useCalendarEventEditor";

// Layout changes keep the same mounted form and draft. The sidebar contains actual CRM
// fields; provider provisioning and invitation delivery retain their separate contracts.
export function CalendarEventDialog(props: CalendarEventDialogProps): React.ReactNode {
  const {
    preferences,
    zone,
    t,
    S,
    attachFields,
    canClose,
    types,
    draft,
    value,
    details,
    setDetails,
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
        if (!open && canClose()) props.onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        dir={preferences.locale === "fa" ? "rtl" : "ltr"}
        className={cn(
          "flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden border-border/80 bg-card p-0",
          details ? "sm:max-w-5xl" : "sm:max-w-2xl",
        )}
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
              <div className={cn(details && "md:grid md:grid-cols-[minmax(0,1fr)_17rem]")}>
                <section
                  aria-label={t("editor.eventDetails")}
                  className="min-w-0 space-y-6 px-6 py-6 sm:px-8"
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
                  <section aria-label={t("editor.dateAndTime")} className="space-y-3">
                    <h3 className="flex items-center gap-3 text-sm font-medium">
                      <Clock3 className="size-4 text-muted-foreground" aria-hidden />
                      {t("editor.dateAndTime")}
                    </h3>
                    <CalendarEventSchedule
                      draft={draft}
                      onStart={moveStart}
                      onEnd={({ date, time }) => change({ endDate: date, endTime: time })}
                      onAllDay={allDay}
                    />
                    {(draft.startTime !== "" ||
                      (props.editing?.allDay === true && props.editing.dueDate == null)) && (
                      <ActivityTimeZoneHint
                        timeZone={zone}
                        date={draft.startDate}
                        time={draft.startTime}
                        originalInstant={props.editing?.dueAt}
                        legacy={props.editing?.allDay === true && props.editing.dueDate == null}
                      />
                    )}
                  </section>
                  <div className="border-t border-border/70 pt-4">
                    <CalendarEventDetails draft={draft} expanded={details} onChange={change} />
                  </div>
                  {error !== null && (
                    <p
                      role="alert"
                      className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm leading-relaxed text-destructive"
                    >
                      {error}
                    </p>
                  )}
                </section>
                {details && (
                  <CalendarEventCrmDetails
                    draft={value}
                    types={types}
                    editing={props.editing}
                    onChange={change}
                  />
                )}
              </div>
            </fieldset>
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border/70 bg-card px-4 py-3 sm:px-6">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t(details ? "editor.fewerOptions" : "editor.moreOptions")}
              aria-expanded={details}
              disabled={pending}
              onClick={() => setDetails(!details)}
              className="text-muted-foreground"
            >
              {details ? (
                <Minimize2 className="size-3.5" aria-hidden />
              ) : (
                <Maximize2 className="size-3.5" aria-hidden />
              )}
              <span className="hidden sm:inline">
                {t(details ? "editor.fewerOptions" : "editor.moreOptions")}
              </span>
            </Button>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" disabled={pending} onClick={props.onClose}>
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
    </Dialog>
  );
}
