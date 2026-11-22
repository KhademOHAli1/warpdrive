import { z } from "zod";
import type { BookingFeedScope } from "./schema";

export const bookingCalendarId = z.uuid().toLowerCase();
const target = { siteId: bookingCalendarId };

export const bookingFeedCommand = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("list"), ...target }),
  z.strictObject({
    type: z.literal("create"),
    ...target,
    requestId: bookingCalendarId,
    scope: z.enum(["self", "site"]),
  }),
  z.strictObject({
    type: z.literal("revoke"),
    ...target,
    feedId: bookingCalendarId,
  }),
]);

export type BookingFeedCommand = z.infer<typeof bookingFeedCommand>;
export type BookingFeed = {
  id: string;
  siteId: string;
  scope: BookingFeedScope;
  createdAt: string;
  revokedAt: string | null;
};
export type BookingFeedResult =
  | { ok: true; feeds: BookingFeed[]; created: { id: string; secret: string } | null }
  | { ok: false; error: "invalid" | "unavailable" | "conflict" };

export function bookingCalendarDownloadPath(bookingId: string) {
  return `/api/assets/bookings/${encodeURIComponent(bookingId)}/calendar.ics`;
}

export function bookingFeedSubscriptionPath(feedId: string, secret: string) {
  return `/api/assets/bookings/feeds/${encodeURIComponent(feedId)}/calendar.ics?${new URLSearchParams(
    {
      token: secret,
    },
  )}`;
}
