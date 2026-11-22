import type {
  Booking,
  BookingAvailabilityInput,
  BookingAvailabilityResult,
  BookingError,
  BookingKind,
  BookingResource,
  BookingSite,
  BookingsWorkspace,
} from "../contracts";
import type { BookingWords } from "./messages";

export type CheckBookingAvailability = (
  input: BookingAvailabilityInput,
) => Promise<BookingAvailabilityResult>;

export const bookingKindLabel = {
  asset: "asset",
  model: "model",
  kit: "kit",
  returnable_pool: "returnable",
  consumable_pool: "consumable",
} as const satisfies Record<BookingKind, keyof BookingWords>;

export function bookingErrorText(error: BookingError | "transport", words: BookingWords): string {
  switch (error) {
    case "unavailable":
      return words.unavailableError;
    case "closed_hours":
      return words.schedule;
    case "insufficient_notice":
      return words.minNoticeError;
    case "duration":
      return words.durationError;
    case "invalid":
    case "stale":
    case "conflict":
    case "state":
    case "capacity":
    case "transport":
      return words[error];
  }
}

export function pooledBookingKind(kind: BookingKind) {
  return kind === "returnable_pool" || kind === "consumable_pool";
}

export function bookingStatus(
  booking: Booking,
): "archived" | "draft" | "pending" | "confirmed" | "cancelled" {
  return booking.archived ? "archived" : booking.status;
}

export function canRequestBooking(site: BookingSite | undefined): boolean {
  return site !== undefined && site.role !== "viewer";
}

export function canManageBooking(
  site: BookingSite,
  booking: Booking,
  workspace: BookingsWorkspace,
) {
  return site.role === "manager" || booking.requesterId === workspace.viewer.id;
}

export function resourceLabel(resource: BookingResource): string {
  const identity = resource.serial ?? resource.code;
  return `${resource.name} · ${identity}`;
}
