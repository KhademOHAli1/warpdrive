import { Temporal } from "@js-temporal/polyfill";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { isUuidParam } from "@/lib/isUuidParam";

const statuses = {
  confirmed: "CONFIRMED",
  tentative: "TENTATIVE",
  cancelled: "CANCELLED",
} as const;

export type BookingCalendarEvent = {
  id: string;
  startsAt: string;
  endsAt: string;
  updatedAt: string;
  version: number;
  summary?: string;
  status?: keyof typeof statuses;
};

const encoder = new TextEncoder();
const eventDomain = "booking.warpdrive.invalid";

function calendarInstant(value: string): string {
  const instant = Temporal.Instant.from(value).toString({ smallestUnit: "second" });
  if (!/^\d{4}-/u.test(instant) || instant.startsWith("0000-"))
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Booking calendar instant is out of range");
  return instant.replace(/[-:]/gu, "");
}

function calendarText(value: string): string {
  return value
    .replace(/[\\;,]/gu, "\\$&")
    .replace(/\r\n|\r|\n/gu, "\\n")
    .replace(/\p{Cc}/gu, (control) => (control === "\t" ? control : " "))
    .replace(/\p{Surrogate}/gu, "�");
}

// Continuation lines start with one space, which counts toward their octet limit.
function foldLine(line: string): string {
  if (encoder.encode(line).byteLength <= 75) return line;

  const parts: string[] = [];
  let segment = "";
  let bytes = 0;
  for (const character of line) {
    const length = encoder.encode(character).byteLength;
    if (bytes + length > 75) {
      parts.push(segment);
      segment = " ";
      bytes = 1;
    }
    segment += character;
    bytes += length;
  }
  parts.push(segment);
  return parts.join("\r\n");
}

function calendarEvent(event: BookingCalendarEvent): string[] {
  const { id, updatedAt, version, summary } = event;
  const status = event.status ?? "confirmed";
  const start = calendarInstant(event.startsAt);
  const end = calendarInstant(event.endsAt);
  if (!isUuidParam(id) || start >= end || !Object.hasOwn(statuses, status))
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Booking calendar event is invalid");
  if (!Number.isInteger(version) || version < 0 || version > 2_147_483_647)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Booking calendar sequence is out of range");
  const title = calendarText(summary ?? "");
  return [
    "BEGIN:VEVENT",
    `UID:${id.toLowerCase()}@${eventDomain}`,
    `DTSTAMP:${calendarInstant(updatedAt)}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SEQUENCE:${version}`,
    `STATUS:${statuses[status]}`,
    `SUMMARY:${title.trim() === "" ? "Equipment booking" : title}`,
    "CLASS:PRIVATE",
    "END:VEVENT",
  ];
}

/** Render an already authorized projection. A shared feed can omit every summary. */
export function renderBookingCalendar(events: readonly BookingCalendarEvent[]): string {
  if (new Set(events.map(({ id }) => id.toLowerCase())).size !== events.length)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Booking calendar has duplicate event IDs");

  // RFC 5545 requires a component even when the feed has no bookings. Use a free/busy
  // component with no intervals so a subscriber sees no synthetic reservation.
  const components =
    events.length === 0
      ? ["BEGIN:VFREEBUSY", `UID:empty@${eventDomain}`, "DTSTAMP:19700101T000000Z", "END:VFREEBUSY"]
      : events.flatMap(calendarEvent);

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Warpdrive//Equipment Bookings//EN",
    "CALSCALE:GREGORIAN",
    ...components.map(foldLine),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
