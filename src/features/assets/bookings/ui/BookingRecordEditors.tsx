"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { SalesInput, SalesTextarea } from "@/features/inventory/sales/ui/SalesFields";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import { EditorSelect } from "../../ui/AssetEditorFields";
import {
  type Booking,
  type BookingAvailabilityInput,
  type BookingError,
  type BookingIntent,
  type BookingSite,
  bookingAvailabilityInput,
} from "../contracts";
import {
  type BookingAction,
  BookingDialog,
  type BookingEditor,
  type BookingEditorProps,
  bookingVersion,
} from "./BookingDialog";
import { BookingResourceFields, demandDrafts, readDemand } from "./BookingResourceFields";
import { BookingTimeFields, resolveBookingWindow, windowDraft } from "./BookingTimeFields";
import { bookingErrorText, type CheckBookingAvailability } from "./bookingView";
import type { BookingWords } from "./messages";

type WithSite = BookingEditorProps & { site: BookingSite };

export function EditBookingDialog({
  editor,
  site,
  workspace,
  checkAvailability,
  state,
  words: t,
}: WithSite & {
  editor: Extract<BookingEditor, { type: "edit" }>;
  checkAvailability?: CheckBookingAvailability;
}) {
  const preferences = useLocalePreferences();
  const { booking } = editor;
  const { timeZone } = site.policy;
  const [title, setTitle] = useState(booking?.title ?? "");
  const [description, setDescription] = useState(booking?.description ?? "");
  const [requesterId, setRequester] = useState(booking?.requesterId ?? workspace.viewer.id);
  const [times, setTimes] = useState(() => windowDraft(booking?.window, timeZone));
  const [resources, setResources] = useState(() => demandDrafts(booking?.lines ?? []));
  const selected = resolveBookingWindow(times, timeZone, booking?.window);
  const locale = localeTagForFormatting(preferences);
  const lines = resources.flatMap((draft) => readDemand(draft, locale) ?? []);
  const intent: BookingIntent | null =
    selected !== null && lines.length === resources.length
      ? {
          type: "saveBooking",
          siteId: site.id,
          bookingId: booking?.id ?? null,
          version: booking?.version ?? null,
          title,
          description: description.trim() || null,
          requesterId,
          window: selected.window,
          lines,
        }
      : null;
  const available = workspace.resources.filter(({ siteId }) => siteId === site.id);
  const preflight = bookingAvailabilityInput.safeParse(
    intent === null
      ? null
      : {
          siteId: site.id,
          bookingId: intent.bookingId,
          window: intent.window,
          lines: intent.lines,
        },
  );

  return (
    <BookingDialog
      state={state}
      intent={intent}
      title={booking === undefined ? t.add : booking.status === "draft" ? t.edit : t.editActive}
      description={booking === undefined ? t.addIntro : t.editIntro}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SalesInput
          label={t.title}
          value={title}
          maxLength={120}
          required
          disabled={state.pending}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        {site.role === "manager" && (
          <EditorSelect
            label={t.requester}
            value={requesterId}
            options={requesterOptions(site, workspace.viewer, booking)}
            disabled={state.pending || (booking !== undefined && booking.status !== "draft")}
            onChange={setRequester}
          />
        )}
      </div>
      <SalesTextarea
        label={t.details}
        value={description}
        maxLength={1500}
        rows={2}
        disabled={state.pending}
        onChange={(event) => setDescription(event.currentTarget.value)}
      />
      <BookingTimeFields
        value={times}
        onChange={setTimes}
        pending={state.pending}
        valid={selected !== null}
        ambiguous={selected?.ambiguous === true}
        words={t}
        timeZone={timeZone}
      />
      <BookingResourceFields
        drafts={resources}
        resources={available}
        pending={state.pending}
        words={t}
        onChange={setResources}
      />
      {checkAvailability !== undefined && preflight.success && (
        <AvailabilityCheck
          input={preflight.data}
          check={checkAvailability}
          pending={state.pending}
          words={t}
        />
      )}
    </BookingDialog>
  );
}

function AvailabilityCheck({
  input,
  check,
  pending,
  words: t,
}: {
  input: BookingAvailabilityInput;
  check: CheckBookingAvailability;
  pending: boolean;
  words: BookingWords;
}) {
  const signature = JSON.stringify(input);
  const active = useRef(false);
  const [running, setRunning] = useState(false);
  const [checked, setChecked] = useState<{
    signature: string;
    error: BookingError | "transport" | null;
  }>();
  const result = checked?.signature === signature ? checked : undefined;

  async function run() {
    if (active.current) return;
    active.current = true;
    setRunning(true);
    setChecked(undefined);
    try {
      const result = await check(input);
      setChecked({ signature, error: result.ok ? null : result.error });
    } catch {
      setChecked({ signature, error: "transport" });
    } finally {
      active.current = false;
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending || running} onClick={() => void run()}>
        {t.checkAvailability}
      </Button>
      {result !== undefined && (
        <p
          role={result.error === null ? "status" : "alert"}
          data-booking-preflight={result.error ?? "available"}
          className={
            result.error === null ? "text-sm text-muted-foreground" : "text-sm text-destructive"
          }
        >
          {result.error === null ? t.available : bookingErrorText(result.error, t)}
        </p>
      )}
    </div>
  );
}

function requesterOptions(
  site: BookingSite,
  viewer: { id: string; name: string },
  booking: Booking | undefined,
) {
  const options = new Map(site.participants.map(({ id, name }) => [id, name]));
  if (!options.has(viewer.id)) options.set(viewer.id, viewer.name);
  if (booking !== undefined && !options.has(booking.requesterId))
    options.set(booking.requesterId, booking.requesterName);
  return [...options].map(([value, label]) => ({ value, label }));
}

function BookingName({ booking }: { booking: Booking }) {
  return (
    <p className="text-sm font-medium [overflow-wrap:anywhere]">
      <bdi>{booking.title}</bdi>
    </p>
  );
}

export function DuplicateBookingDialog({
  editor,
  site,
  state,
  words: t,
}: Omit<WithSite, "workspace"> & { editor: Extract<BookingEditor, { type: "duplicate" }> }) {
  const { booking } = editor;
  const { timeZone } = site.policy;
  const [times, setTimes] = useState(() => windowDraft(undefined, timeZone));
  const selected = resolveBookingWindow(times, timeZone);
  const intent: BookingIntent | null =
    selected === null
      ? null
      : { type: "duplicateBooking", ...bookingVersion(booking), window: selected.window };
  return (
    <BookingDialog state={state} intent={intent} title={t.duplicate} description={t.duplicateIntro}>
      <BookingName booking={booking} />
      <BookingTimeFields
        value={times}
        onChange={setTimes}
        pending={state.pending}
        valid={selected !== null}
        ambiguous={selected?.ambiguous === true}
        words={t}
        timeZone={timeZone}
      />
    </BookingDialog>
  );
}

const actionIntro = {
  submit: "submitIntro",
  approve: "approveIntro",
  sendBack: "sendBackIntro",
  deny: "denyIntro",
  cancel: "cancelIntro",
  archive: "archiveIntro",
  restore: "restoreIntro",
} as const satisfies Record<BookingAction, keyof BookingWords>;

function actionIntent(booking: Booking, action: BookingAction, note: string): BookingIntent | null {
  const base = bookingVersion(booking);
  const reason = note.trim() || null;
  switch (action) {
    case "submit":
      return { type: "submitBooking", ...base };
    case "approve":
      return { type: "reviewBooking", ...base, decision: "approve", reason };
    case "sendBack":
      return reason === null
        ? null
        : { type: "reviewBooking", ...base, decision: "request_changes", reason };
    case "deny":
      return reason === null
        ? null
        : { type: "reviewBooking", ...base, decision: "decline", reason };
    case "cancel":
      return { type: "cancelBooking", ...base, reason };
    case "archive":
      return { type: "archiveBooking", ...base, archived: true };
    case "restore":
      return { type: "archiveBooking", ...base, archived: false };
  }
}

export function BookingActionDialog({
  editor,
  state,
  words: t,
}: Pick<BookingEditorProps, "state" | "words"> & {
  editor: Extract<BookingEditor, { type: "action" }>;
}) {
  const [note, setNote] = useState("");
  const { booking, action } = editor;
  const hasReason =
    action === "approve" || action === "sendBack" || action === "deny" || action === "cancel";
  const required = action === "sendBack" || action === "deny";
  return (
    <BookingDialog
      state={state}
      intent={actionIntent(booking, action, note)}
      title={t[action]}
      description={t[actionIntro[action]]}
    >
      <BookingName booking={booking} />
      {hasReason && (
        <SalesTextarea
          label={required ? t.reason : t.optionalReason}
          value={note}
          rows={3}
          maxLength={500}
          disabled={state.pending}
          required={required}
          onChange={(event) => setNote(event.currentTarget.value)}
        />
      )}
    </BookingDialog>
  );
}
