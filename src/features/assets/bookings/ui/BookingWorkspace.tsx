"use client";

import { Plus, Search } from "lucide-react";
import { type RefObject, useId, useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { type FormattingPreferences, formatDateTime } from "@/lib/localeFormatting";
import { EditorSelect } from "../../ui/AssetEditorFields";
import {
  type Booking,
  type BookingCommand,
  type BookingError,
  type BookingIntent,
  type BookingResult,
  type BookingSite,
  type BookingsWorkspace,
  bookingStatuses,
} from "../contracts";
import { BookingCalendar } from "./BookingCalendar";
import { BookingDetail } from "./BookingDetail";
import type { BookingDialogState, BookingEditor, OpenBookingEditor } from "./BookingDialog";
import {
  MaintenanceEditorDialog,
  PolicyEditorDialog,
  RemoveMaintenanceDialog,
} from "./BookingPolicyEditors";
import {
  BookingActionDialog,
  DuplicateBookingDialog,
  EditBookingDialog,
} from "./BookingRecordEditors";
import { BookingSettings } from "./BookingSettings";
import {
  bookingErrorText,
  bookingStatus,
  type CheckBookingAvailability,
  canRequestBooking,
} from "./bookingView";
import { type BookingWords, bookingMessages } from "./messages";

type SubmitBooking = (command: BookingCommand) => Promise<BookingResult>;
const tabs = ["bookings", "calendar", "settings"] as const;
type Tab = (typeof tabs)[number];

type ListFilters = { search: string; status: string; ownership: "all" | "own" };
const clearFilters: ListFilters = { search: "", status: "", ownership: "all" };

function filterBookings(rows: Booking[], filters: ListFilters, viewerId: string, language: string) {
  const query = filters.search.trim().toLocaleLowerCase(language);
  return rows
    .filter((row) => {
      if (filters.ownership === "own" && row.requesterId !== viewerId) return false;
      if (filters.status === "" ? row.archived : bookingStatus(row) !== filters.status)
        return false;
      return [row.title, row.requesterName].some((text) =>
        text.toLocaleLowerCase(language).includes(query),
      );
    })
    .sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title, language),
    );
}

function BookingListFilters({
  filters,
  manager,
  searchInput,
  onFilters,
  words: t,
}: {
  filters: ListFilters;
  manager: boolean;
  searchInput: RefObject<HTMLInputElement | null>;
  onFilters: (filters: ListFilters) => void;
  words: BookingWords;
}) {
  const id = useId();
  return (
    <div className="grid items-end gap-2 rounded-lg border bg-card p-3 sm:grid-cols-3">
      <div className="space-y-1">
        <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
          {t.search}
        </label>
        <div className="relative">
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={id}
            ref={searchInput}
            type="search"
            value={filters.search}
            className="h-9 ps-8"
            onChange={(event) => onFilters({ ...filters, search: event.currentTarget.value })}
          />
        </div>
      </div>
      <EditorSelect
        label={t.status}
        value={filters.status}
        options={[
          { value: "", label: t.allStatuses },
          ...bookingStatuses.map((value) => ({ value, label: t[value] })),
          { value: "archived", label: t.archived },
        ]}
        onChange={(status) => onFilters({ ...filters, status })}
      />
      {manager && (
        <EditorSelect
          label={t.bookings}
          value={filters.ownership}
          options={[
            { value: "all", label: t.all },
            { value: "own", label: t.own },
          ]}
          onChange={(next) => onFilters({ ...filters, ownership: next === "own" ? "own" : "all" })}
        />
      )}
    </div>
  );
}

function BookingRows({
  rows,
  activeId,
  site,
  preferences,
  select,
  words: t,
}: {
  rows: Booking[];
  activeId: string;
  site: BookingSite;
  preferences: FormattingPreferences;
  select: (id: string) => void;
  words: BookingWords;
}) {
  const format = (value: string) =>
    formatDateTime(value, { ...preferences, timeZone: site.policy.timeZone });
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border bg-card">
      <table aria-label={t.bookings} className="w-full min-w-[27rem] border-collapse text-sm">
        <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t.booking}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t.pickup}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t.status}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((booking) => (
            <tr
              key={booking.id}
              data-booking-row={booking.id}
              data-selected={activeId === booking.id}
              className="hover:bg-muted/40 data-[selected=true]:bg-accent/70"
            >
              <th scope="row" className="max-w-64 px-3 py-2.5 text-start font-normal">
                <button
                  type="button"
                  aria-controls="booking-details"
                  aria-pressed={activeId === booking.id}
                  onClick={() => select(booking.id)}
                  className="block rounded text-start font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]"
                >
                  <bdi>{booking.title}</bdi>
                </button>
                <bdi className="text-xs text-muted-foreground">{booking.requesterName}</bdi>
              </th>
              <td className="px-3 py-2.5">
                <time dateTime={booking.window.startAt}>{format(booking.window.startAt)}</time>
              </td>
              <td className="px-3 py-2.5">
                <Badge variant="outline">{t[bookingStatus(booking)]}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderBookingEditor(
  editor: BookingEditor,
  site: BookingSite,
  workspace: BookingsWorkspace,
  state: BookingDialogState,
  words: BookingWords,
  checkAvailability: CheckBookingAvailability | undefined,
) {
  const props = { editor, site, workspace, state, words };
  switch (editor.type) {
    case "edit":
      return <EditBookingDialog {...props} editor={editor} checkAvailability={checkAvailability} />;
    case "duplicate":
      return <DuplicateBookingDialog {...{ editor, site, state, words }} />;
    case "action":
      return <BookingActionDialog {...{ editor, state, words }} />;
    case "policy":
      return <PolicyEditorDialog {...{ site, state, words }} />;
    case "maintenance":
      return <MaintenanceEditorDialog {...props} editor={editor} />;
    case "removeMaintenance":
      return <RemoveMaintenanceDialog {...{ editor, state, words }} />;
  }
}

function useBookingEditor({
  submit,
  onSaved,
  fallbackFocus,
}: {
  submit: SubmitBooking;
  onSaved: (result: Extract<BookingResult, { ok: true }>) => void;
  fallbackFocus: RefObject<HTMLInputElement | null>;
}) {
  const [editor, setEditor] = useState<BookingEditor | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BookingError | "transport" | null>(null);
  const [saved, setSaved] = useState(false);
  const active = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const unconfirmed = useRef<{ intent: string; requestId: string } | null>(null);

  const open: OpenBookingEditor = (button, action) => {
    if (active.current) return;
    trigger.current = button;
    setEditor(action);
    setSaved(false);
    setError(null);
  };

  function close() {
    if (active.current) return;
    setEditor(null);
    setError(null);
  }

  function restoreFocus() {
    if (trigger.current?.isConnected === true) trigger.current.focus();
    else fallbackFocus.current?.focus();
  }

  async function save(intent: BookingIntent) {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setError(null);
    const key = JSON.stringify(intent);
    const previous = unconfirmed.current;
    const requestId = previous?.intent === key ? previous.requestId : crypto.randomUUID();
    unconfirmed.current = { intent: key, requestId };
    try {
      const result = await submit({ ...intent, requestId });
      unconfirmed.current = null;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result);
      setEditor(null);
      setSaved(true);
    } catch {
      setError("transport");
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  return { editor, pending, error, saved, open, close, restoreFocus, save };
}

function preferredTab(tab: Tab, site: BookingSite): Tab {
  if (tab === "settings" && site.role !== "manager") return "bookings";
  if (tab === "bookings" && site.role === "viewer") return "calendar";
  return tab;
}

export function BookingWorkspace({
  initial,
  submit,
  checkAvailability,
  fixture,
}: {
  initial: BookingsWorkspace;
  submit: SubmitBooking;
  checkAvailability?: CheckBookingAvailability;
  fixture: boolean;
}) {
  const preferences = useLocalePreferences();
  const t = bookingMessages[preferences.locale];
  const [source, setSource] = useState(initial);
  const [workspace, setWorkspace] = useState(initial);
  const [siteId, setSite] = useState(initial.sites[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("bookings");
  const [filters, setFilters] = useState(clearFilters);
  const [selectionId, setSelection] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);

  if (source !== initial) {
    setSource(initial);
    setWorkspace(initial);
  }

  function onSaved({ value, bookingId }: Extract<BookingResult, { ok: true }>) {
    setWorkspace(value);
    if (bookingId === null) return;
    const selected = value.bookings.find(({ id }) => id === bookingId);
    if (selected === undefined) return;
    setSelection(bookingId);
    setFilters({ ...clearFilters, status: selected.archived ? "archived" : "" });
  }

  const action = useBookingEditor({ submit, onSaved, fallbackFocus: searchInput });
  const site = workspace.sites.find(({ id }) => id === siteId) ?? workspace.sites[0];
  const title = <PageHeading title={t.bookings} crumbs={[{ label: t.assets, href: "/assets" }]} />;
  if (site === undefined) {
    return (
      <section className={`${BLOCK_CLASS} ph-no-capture min-w-0`}>
        {title}
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{t.noSites}</p>
      </section>
    );
  }

  const activeTab = preferredTab(tab, site);
  const editor = action.editor?.siteId === site.id && site.role !== "viewer" ? action.editor : null;
  const atSite = workspace.bookings.filter(({ siteId }) => siteId === site.id);
  const rows = filterBookings(atSite, filters, workspace.viewer.id, preferences.locale);
  const selected = rows.find(({ id }) => id === selectionId) ?? rows[0];

  function openFromCalendar(id: string) {
    setFilters(clearFilters);
    setSelection(id);
    setTab("bookings");
  }

  return (
    <section className={`${BLOCK_CLASS} ph-no-capture min-w-0`} aria-busy={action.pending}>
      {title}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="w-56 max-w-full">
          <EditorSelect
            label={t.site}
            value={site.id}
            options={workspace.sites.map(({ id, name }) => ({ value: id, label: name }))}
            onChange={(next) => {
              setSite(next);
              setSelection(null);
              setFilters(clearFilters);
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {fixture && <Badge variant="outline">{t.demo}</Badge>}
          {canRequestBooking(site) && activeTab !== "settings" && (
            <Button
              disabled={action.pending}
              onClick={(event) =>
                action.open(event.currentTarget, { type: "edit", siteId: site.id })
              }
            >
              <Plus aria-hidden="true" size={16} /> {t.add}
            </Button>
          )}
        </div>
      </div>
      {action.saved && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {t.saved}
        </p>
      )}
      <Tabs
        value={activeTab}
        onValueChange={(value) => setTab(tabs.find((tab) => tab === value) ?? "bookings")}
      >
        <TabsList
          aria-label={t.bookings}
          className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg border bg-card p-0.5"
        >
          {site.role !== "viewer" && (
            <TabsTrigger className={PILL_TAB} value="bookings">
              {t.bookings}
            </TabsTrigger>
          )}
          <TabsTrigger className={PILL_TAB} value="calendar">
            {t.calendar}
          </TabsTrigger>
          {site.role === "manager" && (
            <TabsTrigger className={PILL_TAB} value="settings">
              {t.settings}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="bookings" className="space-y-3">
          <BookingListFilters
            filters={filters}
            manager={site.role === "manager"}
            searchInput={searchInput}
            words={t}
            onFilters={setFilters}
          />
          {selected === undefined ? (
            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              {atSite.length === 0 ? t.noBookings : t.noMatches}
            </p>
          ) : (
            <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,4fr)_minmax(20rem,5fr)]">
              <BookingRows
                {...{ rows, site, preferences }}
                activeId={selected.id}
                select={setSelection}
                words={t}
              />
              <BookingDetail
                {...{ site, workspace }}
                booking={selected}
                pending={action.pending}
                open={action.open}
                words={t}
              />
            </div>
          )}
        </TabsContent>
        <TabsContent value="calendar">
          <BookingCalendar
            key={site.id}
            site={site}
            entries={workspace.calendar.filter(({ siteId }) => siteId === site.id)}
            words={t}
            onOpenBooking={openFromCalendar}
          />
        </TabsContent>
        {site.role === "manager" && (
          <TabsContent value="settings">
            <BookingSettings
              site={site}
              maintenance={workspace.maintenance.filter(({ siteId }) => siteId === site.id)}
              pending={action.pending}
              open={action.open}
              words={t}
            />
          </TabsContent>
        )}
      </Tabs>
      {editor !== null &&
        renderBookingEditor(
          editor,
          site,
          workspace,
          {
            pending: action.pending,
            error: action.error === null ? null : bookingErrorText(action.error, t),
            close: action.close,
            save: (intent) => void action.save(intent),
            restoreFocus: action.restoreFocus,
          },
          t,
          checkAvailability,
        )}
    </section>
  );
}
