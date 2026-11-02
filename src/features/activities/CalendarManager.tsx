"use client";
import { Archive, CalendarDays, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { CalendarEventTimeZone } from "./CalendarEventTimeZone";
import { CalendarReminderDefaultsPanel } from "./CalendarReminderDefaultsPanel";
import { CalendarSettingsForm } from "./CalendarSettingsForm";
import { createCalendarAction, setCalendarArchivedAction } from "./calendarActions";
import { useCalendarMutation } from "./useCalendarMutation";
import { useCalendarNavigationGuard } from "./useCalendarNavigationGuard";
export function CalendarManager({ onChanged }: { onChanged?: () => void }): React.ReactNode {
  const t = useAppTranslations("calendar");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Settings2 className="size-4" aria-hidden />
        {t("settings.manage")}
      </Button>
      {open && <CalendarManagerDialog onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}
function CalendarManagerDialog({
  onChanged,
  onClose,
}: {
  onChanged?: () => void;
  onClose: () => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const prefs = useLocalePreferences();
  const [archived, setArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState(prefs.timeZone);
  const [dirty, setDirty] = useState(false);
  const [reminderDirty, setReminderDirty] = useState(false);
  const [reminderPending, setReminderPending] = useState(false);
  const query = trpc.calendars.list.useQuery({ includeArchived: archived });
  const utils = trpc.useUtils();
  const { pending, error, run } = useCalendarMutation();
  const guard = useCalendarNavigationGuard(
    dirty || reminderDirty || name !== "" || timeZone !== prefs.timeZone,
    pending || reminderPending,
  );
  function navigate(action: () => void): void {
    guard.navigate(() => {
      setDirty(false);
      setReminderDirty(false);
      setName("");
      setTimeZone(prefs.timeZone);
      action();
    });
  }
  const calendars = (query.data ?? []).filter(
    (calendar) => !archived || calendar.deletedAt !== null,
  );
  const selected = calendars.find(
    (calendar) => calendar.id === selectedId && calendar.deletedAt === null,
  );
  async function changed(): Promise<void> {
    await utils.calendars.list.invalidate();
    await query.refetch();
    setSelectedId(null);
    setDirty(false);
    setReminderDirty(false);
    setName("");
    setTimeZone(prefs.timeZone);
    onChanged?.();
  }
  async function refreshSelected(): Promise<void> {
    await utils.calendars.list.invalidate();
    await query.refetch();
    setDirty(false);
    onChanged?.();
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) navigate(onClose);
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        dir={prefs.locale === "fa" ? "rtl" : "ltr"}
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        <DialogHeader className="shrink-0 border-b px-6 py-5 pe-12">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="size-5 text-muted-foreground" aria-hidden />
            {t("settings.manage")}
          </DialogTitle>
        </DialogHeader>
        <div className="relative min-h-0 overflow-y-auto">
          <fieldset
            disabled={pending || reminderPending}
            inert={pending || reminderPending}
            className="min-w-0 md:grid md:grid-cols-[15rem_minmax(0,1fr)]"
          >
            <nav
              aria-label={t("settings.calendars")}
              className="space-y-3 border-b bg-muted/20 p-4 md:border-e md:border-b-0"
            >
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={!archived}
                  onClick={() => {
                    navigate(() => {
                      setArchived(false);
                      setSelectedId(null);
                    });
                  }}
                >
                  {t("settings.active")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={archived}
                  onClick={() => {
                    navigate(() => {
                      setArchived(true);
                      setSelectedId(null);
                    });
                  }}
                >
                  <Archive className="size-3.5" aria-hidden />
                  {t("settings.archived")}
                </Button>
              </div>
              {query.isError ? (
                <p role="alert" className="text-xs text-destructive">
                  {t("settings.loadFailed")}
                </p>
              ) : (
                calendars.map((calendar) => (
                  <div key={calendar.id}>
                    <Button
                      variant={calendar.id === selectedId ? "outline" : "ghost"}
                      className="w-full justify-start whitespace-normal text-start"
                      onClick={() => navigate(() => setSelectedId(calendar.id))}
                    >
                      {calendar.name === "" ? t("settings.personal") : calendar.name}
                    </Button>
                    {archived && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="ms-3 mt-1"
                        onClick={() => {
                          void run(async () => {
                            const result = await setCalendarArchivedAction(
                              { id: calendar.id, archived: false },
                              readCsrfToken(),
                            );
                            if (result.ok) await changed();
                            return result;
                          });
                        }}
                      >
                        {t("settings.restore")}
                      </Button>
                    )}
                  </div>
                ))
              )}
              {!archived && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => navigate(() => setSelectedId(null))}
                >
                  <Plus className="size-3.5" aria-hidden />
                  {t("settings.new")}
                </Button>
              )}
            </nav>
            <section className="min-w-0 p-6">
              {selected?.role === "owner" ? (
                <CalendarSettingsForm
                  key={`settings:${selected.id}`}
                  calendar={selected}
                  run={run}
                  onChanged={refreshSelected}
                  onArchived={changed}
                  onDirtyChange={setDirty}
                />
              ) : archived ? (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t("settings.restoreHint")}
                </p>
              ) : selected !== undefined ? (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t("settings.sharedReadOnly")}
                </p>
              ) : (
                <form
                  className="space-y-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      const result = await createCalendarAction(
                        { name, timeZone },
                        readCsrfToken(),
                      );
                      if (result.ok) {
                        setName("");
                        await changed();
                      }
                      return result;
                    });
                  }}
                >
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold">{t("settings.new")}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {t("settings.newHint")}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor="new-calendar-name"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t("settings.name")}
                    </label>
                    <Input
                      id="new-calendar-name"
                      dir="auto"
                      value={name}
                      maxLength={100}
                      required
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                  <CalendarEventTimeZone
                    value={timeZone}
                    onChange={setTimeZone}
                    label={t("settings.timeZone")}
                    hint={t("settings.timeZoneHint")}
                  />
                  <Button type="submit" disabled={name.trim() === ""}>
                    {t("settings.create")}
                  </Button>
                </form>
              )}
              {selected !== undefined &&
                (selected.role === "owner" ||
                  selected.role === "editor" ||
                  selected.role === "reader") && (
                  <CalendarReminderDefaultsPanel
                    key={`reminders:${selected.id}`}
                    calendarId={selected.id}
                    timeZone={selected.timeZone}
                    disabled={pending}
                    onDirtyChange={setReminderDirty}
                    onPendingChange={setReminderPending}
                  />
                )}
              {error !== null && (
                <p role="alert" className="mt-4 text-sm text-destructive">
                  {error}
                </p>
              )}
            </section>
          </fieldset>
        </div>
        <footer className="flex shrink-0 justify-end border-t px-6 py-3">
          <Button
            variant="outline"
            disabled={pending || reminderPending}
            onClick={() => navigate(onClose)}
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
