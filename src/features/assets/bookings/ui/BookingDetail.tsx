"use client";

import { CalendarDays, Printer } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateTime } from "@/lib/localeFormatting";
import { useHydrated } from "@/lib/useHydrated";
import { renderBookingCalendar } from "../calendar";
import type { Booking, BookingSite, BookingsWorkspace } from "../contracts";
import type { BookingAction, OpenBookingEditor } from "./BookingDialog";
import { BookingPullList } from "./BookingPullList";
import { bookingKindLabel, bookingStatus, canManageBooking } from "./bookingView";
import type { BookingWords } from "./messages";

function downloadEvent(booking: Booking) {
  if (booking.status === "draft") return;
  const content = renderBookingCalendar([
    {
      id: booking.id,
      startsAt: booking.window.startAt,
      endsAt: booking.window.endAt,
      updatedAt: booking.updatedAt,
      version: booking.version,
      summary: booking.title,
      status: booking.status === "pending" ? "tentative" : booking.status,
    },
  ]);
  const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `booking-${booking.id}.ics`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

function RecordActions({
  booking,
  site,
  workspace,
  pending,
  open,
  words: t,
}: {
  booking: Booking;
  site: BookingSite;
  workspace: BookingsWorkspace;
  pending: boolean;
  open: OpenBookingEditor;
  words: BookingWords;
}) {
  const hydrated = useHydrated();
  if (site.role === "viewer" || !canManageBooking(site, booking, workspace)) return null;
  const actions = editableActions(booking, site, hydrated);
  const canEdit = !booking.archived && booking.status !== "cancelled";
  return (
    <div className="flex flex-wrap gap-2">
      {canEdit && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={(event) => open(event.currentTarget, { type: "edit", siteId: site.id, booking })}
        >
          {booking.status === "draft" ? t.edit : t.editActive}
        </Button>
      )}
      {actions.map((action) => (
        <Button
          key={action}
          size="sm"
          variant={action === "submit" || action === "approve" ? "default" : "outline"}
          disabled={pending}
          onClick={(event) =>
            open(event.currentTarget, { type: "action", siteId: site.id, booking, action })
          }
        >
          {t[action]}
        </Button>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={(event) =>
          open(event.currentTarget, { type: "duplicate", siteId: site.id, booking })
        }
      >
        {t.duplicate}
      </Button>
    </div>
  );
}

function editableActions(booking: Booking, site: BookingSite, hydrated: boolean): BookingAction[] {
  if (booking.archived) return ["restore"];
  if (booking.status === "cancelled") return ["archive"];
  const actions: BookingAction[] = ["cancel"];
  if (booking.status === "draft") return ["submit", "cancel", "archive"];
  if (booking.status === "pending" && site.role === "manager")
    actions.unshift("approve", "sendBack", "deny");
  if (hydrated && Date.parse(booking.window.endAt) <= Date.now()) actions.push("archive");
  return actions;
}

function BookingDocuments({
  booking,
  site,
  words: t,
}: {
  booking: Booking;
  site: BookingSite;
  words: BookingWords;
}) {
  const [print, setPrint] = useState(false);
  const printButton = useRef<HTMLButtonElement | null>(null);
  if (booking.status === "draft") return null;
  const allowPrint = booking.status === "confirmed";
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          data-booking-download
          onClick={() => downloadEvent(booking)}
        >
          <CalendarDays size={15} aria-hidden="true" /> {t.calendarEvent}
        </Button>
        {allowPrint && (
          <Button
            ref={printButton}
            size="sm"
            variant="outline"
            data-booking-pull-list-open
            onClick={() => setPrint(true)}
          >
            <Printer size={15} aria-hidden="true" /> {t.print}
          </Button>
        )}
      </div>
      {print && allowPrint && (
        <BookingPullList
          list={{
            name: booking.title,
            site: site.name,
            dueAt: booking.window.endAt,
            timeZone: site.policy.timeZone,
            custodian: booking.requesterName,
            lines: booking.lines,
          }}
          close={() => setPrint(false)}
          restoreFocus={() => printButton.current?.focus()}
        />
      )}
    </>
  );
}

export function BookingDetail({
  booking,
  site,
  workspace,
  pending,
  open,
  words: t,
}: {
  booking: Booking;
  site: BookingSite;
  workspace: BookingsWorkspace;
  pending: boolean;
  open: OpenBookingEditor;
  words: BookingWords;
}) {
  const hydrated = useHydrated();
  const preferences = { ...useLocalePreferences(), timeZone: site.policy.timeZone };
  const format = (value: string) => (hydrated ? formatDateTime(value, preferences) : value);
  const timeline = [...booking.history].sort((a, b) => b.version - a.version);
  return (
    <section
      id="booking-details"
      aria-label={t.detail}
      data-booking-detail={booking.id}
      className="min-w-0 divide-y rounded-lg border bg-card text-sm"
    >
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
            <bdi>{booking.title}</bdi>
          </h2>
          <Badge variant="outline" data-booking-status={bookingStatus(booking)}>
            {t[bookingStatus(booking)]}
          </Badge>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">{t.requester}</dt>
            <dd>
              <bdi>{booking.requesterName}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t.site}</dt>
            <dd>
              <bdi>{site.name}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t.pickup}</dt>
            <dd>
              <time data-booking-pickup dateTime={booking.window.startAt}>
                {format(booking.window.startAt)}
              </time>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t.returns}</dt>
            <dd>
              <time data-booking-return dateTime={booking.window.endAt}>
                {format(booking.window.endAt)}
              </time>
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          {t.zone} <bdi>{site.policy.timeZone}</bdi>
        </p>
        {booking.description !== null && (
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            <bdi>{booking.description}</bdi>
          </p>
        )}
        <RecordActions {...{ booking, site, workspace, pending, open, words: t }} />
        <BookingDocuments booking={booking} site={site} words={t} />
      </div>
      <div className="space-y-2 p-4">
        <h3 className="font-semibold">{t.resources}</h3>
        {booking.lines.length === 0 ? (
          <p className="text-muted-foreground">{t.noResources}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {booking.lines.map((line) => (
              <li
                key={`${line.kind}:${line.resourceId}:${line.locationId ?? ""}`}
                className="flex flex-wrap justify-between gap-x-3 p-3"
              >
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p className="font-medium">
                    <bdi>{line.name}</bdi>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t[bookingKindLabel[line.kind]]}
                    <bdi className="ms-2">{line.serial ?? line.code}</bdi>
                    {line.bin !== null && <bdi className="ms-2">{line.bin}</bdi>}
                  </p>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t.quantity} {line.quantity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-2 p-4">
        <h3 className="font-semibold">{t.history}</h3>
        {timeline.length === 0 ? (
          <p className="text-muted-foreground">{t.noHistory}</p>
        ) : (
          <ol className="divide-y">
            {timeline.map((event) => (
              <li
                key={event.version}
                data-booking-history-kind={event.kind}
                className="space-y-1 py-2 first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap justify-between gap-x-2">
                  <p className="font-medium">{t[event.kind]}</p>
                  <time className="text-xs text-muted-foreground" dateTime={event.at}>
                    {format(event.at)}
                  </time>
                </div>
                <p className="text-xs text-muted-foreground">
                  <bdi>{event.actor}</bdi>
                </p>
                {event.reason !== null && (
                  <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                    <bdi>{event.reason}</bdi>
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
