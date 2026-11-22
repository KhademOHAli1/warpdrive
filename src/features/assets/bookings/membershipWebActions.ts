"use server";

import { invokeAction } from "@/frontend/actions";
import type { BookingMembershipCommand, BookingMembershipResult } from "./membershipContracts";

export async function executeBookingMembershipAction(
  actorId: string,
  command: BookingMembershipCommand,
  csrf: string | null,
): Promise<BookingMembershipResult> {
  return invokeAction(
    "features/assets/bookings/membershipWebActions.executeBookingMembershipAction",
    [actorId, command, csrf],
  );
}
