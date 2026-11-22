"use client";

import { type MouseEvent, type RefObject, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateTime } from "@/lib/localeFormatting";
import type { Booking, BookingError } from "../../contracts";
import { bookingErrorText } from "../../ui/bookingView";
import { bookingMessages } from "../../ui/messages";
import type {
  BookingHandoverAccess,
  BookingHandoverIntent,
  BookingHandoverRead,
  BookingHandoverView,
} from "../contracts";
import { CheckInDialog } from "./CheckInDialog";
import { HandoverChangeDialog } from "./HandoverChangeDialog";
import type { DialogType, HandoverDialogState } from "./HandoverDialog";
import { HandoverHistory } from "./HandoverReceipt";
import { type HandoverWords, handoverMessages } from "./messages";
import { PickupDialog } from "./PickupDialog";

type ReadError = BookingError | "transport";
type ReadResult = BookingHandoverRead | { ok: false; error: "transport" };
type ReadSnapshot = {
  read: BookingHandoverAccess["read"];
  bookingVersion: number;
  reload: number;
  result: ReadResult;
};

function useHandoverView(booking: Booking, read: BookingHandoverAccess["read"]) {
  const [snapshot, setSnapshot] = useState<ReadSnapshot | null>(null);
  const [reload, setReload] = useState(0);
  const { id, version: bookingVersion } = booking;
  useEffect(() => {
    let relevant = true;
    async function fetchView() {
      let result: ReadResult;
      try {
        result = await read(id);
      } catch {
        result = { ok: false, error: "transport" };
      }
      if (!relevant) return;
      setSnapshot((current) => {
        if (
          current?.read === read &&
          current.result.ok &&
          result.ok &&
          current.result.value.version > result.value.version
        )
          return current;
        return { read, bookingVersion, reload, result };
      });
    }
    void fetchView();
    return () => {
      relevant = false;
    };
  }, [id, bookingVersion, read, reload]);
  const current =
    snapshot?.read === read &&
    snapshot.bookingVersion === bookingVersion &&
    snapshot.reload === reload
      ? snapshot.result
      : null;
  return {
    current,
    refresh: () => setReload((revision) => revision + 1),
    accept: (view: BookingHandoverView) => {
      setSnapshot({
        read,
        reload,
        bookingVersion: view.bookingVersion,
        result: { ok: true, value: view },
      });
    },
  };
}

function useHandoverEditor({
  submit,
  onSaved,
  fallbackFocus,
}: {
  submit: BookingHandoverAccess["submit"];
  onSaved: (view: BookingHandoverView, booking: Booking) => void;
  fallbackFocus: RefObject<HTMLHeadingElement | null>;
}) {
  const [dialog, setDialog] = useState<DialogType | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ReadError | null>(null);
  const [saved, setSaved] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const mounted = useRef(false);
  const active = useRef(false);
  const unconfirmed = useRef<{ key: string; requestId: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function open(event: MouseEvent<HTMLButtonElement>, type: DialogType) {
    if (active.current) return;
    trigger.current = event.currentTarget;
    setDialog(type);
    setError(null);
    setSaved(false);
  }

  function close() {
    if (!active.current) setDialog(null);
  }

  function restoreFocus() {
    if (trigger.current?.isConnected === true) trigger.current.focus();
    else fallbackFocus.current?.focus();
  }

  async function save(intent: BookingHandoverIntent) {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setError(null);
    const key = JSON.stringify(intent);
    const prior = unconfirmed.current;
    const requestId = prior?.key === key ? prior.requestId : crypto.randomUUID();
    unconfirmed.current = { key, requestId };
    try {
      const result = await submit({ ...intent, requestId });
      if (!mounted.current) return;
      unconfirmed.current = null;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.value, result.booking);
      setDialog(null);
      setSaved(true);
    } catch {
      if (mounted.current) setError("transport");
    } finally {
      active.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return { dialog, open, close, restoreFocus, pending, error, saved, save };
}

type Editor = ReturnType<typeof useHandoverEditor>;

function canEdit(view: BookingHandoverView, booking: Booking) {
  return view.canOperate && !booking.archived && booking.status === "confirmed";
}

function canPickUp(view: BookingHandoverView) {
  return !view.pickupClosed && (view.status === "ready" || view.status === "ongoing");
}

function HandoverActions({
  view,
  editor,
  busy,
  words: t,
}: {
  view: BookingHandoverView;
  editor: Editor;
  busy: boolean;
  words: HandoverWords;
}) {
  const pickup = canPickUp(view);
  const outstanding = view.allocations.some((row) => row.outstanding > 0);
  const available = view.lines.some((line) => line.options.some(({ available }) => available > 0));
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {pickup && (
          <Button
            size="sm"
            disabled={busy || !available}
            onClick={(event) => editor.open(event, "pickup")}
          >
            {t.startPickup}
          </Button>
        )}
        {outstanding && (
          <Button
            size="sm"
            disabled={busy}
            variant={pickup ? "outline" : "default"}
            onClick={(event) => editor.open(event, "checkIn")}
          >
            {t.startCheckIn}
          </Button>
        )}
        {outstanding && (
          <Button
            size="sm"
            disabled={busy}
            variant="outline"
            onClick={(event) => editor.open(event, "amendDue")}
          >
            {t.startAmend}
          </Button>
        )}
        {pickup && (
          <Button
            size="sm"
            disabled={busy}
            variant="outline"
            onClick={(event) => editor.open(event, "closePickup")}
          >
            {t.startClose}
          </Button>
        )}
      </div>
      {pickup && !available && <p className="text-muted-foreground">{t.noAvailable}</p>}
    </>
  );
}

function HandoverProgress({ view, words: t }: { view: BookingHandoverView; words: HandoverWords }) {
  const outstanding = view.allocations.filter((row) => row.outstanding > 0);
  return (
    <>
      <section className="space-y-2">
        <h3 className="font-semibold">{t.pickupProgress}</h3>
        <ul className="divide-y rounded-md border">
          {view.lines.map((line) => (
            <li
              key={line.key}
              data-handover-progress={line.key}
              className="flex flex-wrap justify-between gap-x-2 p-2"
            >
              <div className="min-w-0 wrap-anywhere">
                <bdi>
                  {line.name} · {line.code}
                </bdi>
                {line.bin !== null && (
                  <bdi className="block text-xs text-muted-foreground">{line.bin}</bdi>
                )}
              </div>
              <bdi className="tabular-nums">
                {line.picked} / {line.quantity}
              </bdi>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">{t.outstanding}</h3>
        {outstanding.length === 0 ? (
          <p className="text-muted-foreground">{t.noReturns}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {outstanding.map((row) => (
              <li key={row.id} data-handover-outstanding={row.id} className="space-y-1 p-2">
                <div className="flex flex-wrap justify-between gap-x-2">
                  <bdi className="wrap-anywhere">
                    {[row.name, row.code, row.serial].filter(Boolean).join(" · ")}
                  </bdi>
                  <bdi className="tabular-nums">
                    {row.outstanding} / {row.issued}
                  </bdi>
                </div>
                {row.sourceBin !== null && (
                  <p className="text-xs text-muted-foreground">
                    {t.source} <bdi>{row.sourceBin}</bdi>
                  </p>
                )}
                {row.members
                  .filter((member) => member.outstanding > 0)
                  .map((member) => (
                    <p key={member.id} className="ps-3 text-xs text-muted-foreground">
                      <bdi>
                        {[member.name, member.code, member.serial].filter(Boolean).join(" · ")}
                      </bdi>
                      {" · "}
                      <bdi>{member.outstanding}</bdi>
                    </p>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function HandoverNoticeList({
  view,
  timeZone,
  words: t,
}: {
  view: BookingHandoverView;
  timeZone: string;
  words: HandoverWords;
}) {
  const preferences = { ...useLocalePreferences(), timeZone };
  if (view.notices.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{t.notices}</h3>
      <ul className="divide-y rounded-md border">
        {view.notices.map((notice) => (
          <li
            key={notice.id}
            data-handover-notice={notice.kind}
            className="flex flex-wrap justify-between gap-x-2 p-2"
          >
            <span>{t[notice.kind]}</span>
            <time dateTime={notice.at} className="text-xs text-muted-foreground">
              {formatDateTime(notice.at, preferences)}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HandoverEditor({
  type,
  view,
  timeZone,
  state,
  lookup,
  words,
}: {
  type: DialogType;
  view: BookingHandoverView;
  timeZone: string;
  state: HandoverDialogState;
  lookup: BookingHandoverAccess["lookup"];
  words: HandoverWords;
}) {
  if (type === "pickup") return <PickupDialog {...{ view, lookup, state, words }} />;
  if (type === "checkIn") return <CheckInDialog {...{ view, lookup, state, words }} />;
  return <HandoverChangeDialog {...{ type, view, timeZone, state, words }} />;
}

export function BookingHandoverSection({
  booking,
  timeZone,
  access,
  disabled,
  onBooking,
  onLock,
}: {
  booking: Booking;
  timeZone: string;
  access: BookingHandoverAccess;
  disabled: boolean;
  onBooking: (booking: Booking) => void;
  onLock: (locked: boolean) => void;
}) {
  const preferences = { ...useLocalePreferences(), timeZone };
  const t = handoverMessages[preferences.locale];
  const bookingWords = bookingMessages[preferences.locale];
  const read = useHandoverView(booking, access.read);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const editor = useHandoverEditor({
    submit: access.submit,
    fallbackFocus: heading,
    onSaved(view, next) {
      read.accept(view);
      onBooking(next);
    },
  });
  const { current } = read;
  const view = current?.ok === true ? current.value : null;
  const locked =
    editor.pending || view === null || view.status === "ongoing" || view.status === "overdue";
  useEffect(() => onLock(locked), [locked, onLock]);
  const error = current?.ok === false ? bookingErrorText(current.error, bookingWords) : null;
  const operation = editor.error === null ? null : bookingErrorText(editor.error, bookingWords);
  return (
    <section
      data-booking-handover
      className="space-y-3 p-4"
      aria-busy={current === null || editor.pending}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 ref={heading} tabIndex={-1} className="font-semibold">
          {t.handover}
        </h3>
        {view !== null && (
          <Badge
            variant={view.status === "overdue" ? "destructive" : "outline"}
            data-handover-status={view.status}
          >
            {t[view.status]}
          </Badge>
        )}
      </div>
      {current === null && (
        <p role="status" className="text-muted-foreground">
          {t.loading}
        </p>
      )}
      {error !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-muted-foreground">
            {error}
          </p>
          <Button size="sm" variant="outline" onClick={read.refresh}>
            {t.retry}
          </Button>
        </div>
      )}
      {view !== null && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span>
              {t.due}{" "}
              <time data-handover-due dateTime={view.dueAt}>
                {formatDateTime(view.dueAt, preferences)}
              </time>
            </span>
            {view.custodian !== null && (
              <span>
                {t.custodian} <bdi>{view.custodian.name}</bdi>
              </span>
            )}
            {view.pickupClosed && <span>{t.pickupClosed}</span>}
          </div>
          {editor.saved && (
            <p role="status" className="text-muted-foreground">
              {t.saved}
            </p>
          )}
          {canEdit(view, booking) && (
            <HandoverActions {...{ view, editor }} busy={disabled || editor.pending} words={t} />
          )}
          <HandoverProgress view={view} words={t} />
          <HandoverNoticeList {...{ view, timeZone }} words={t} />
          <HandoverHistory receipts={view.receipts} timeZone={timeZone} words={t} />
          {editor.dialog !== null && canEdit(view, booking) && (
            <HandoverEditor
              key={`${editor.dialog}:${view.version}`}
              type={editor.dialog}
              {...{ view, timeZone }}
              lookup={access.lookup}
              words={t}
              state={{
                pending: editor.pending,
                error: operation,
                restoreFocus: editor.restoreFocus,
                close: editor.close,
                submit: (intent) => void editor.save(intent),
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
