"use server";

import { invokeAction } from "@/frontend/actions";
import type { BookingFeedCommand, BookingFeedResult } from "./feedContracts";

export async function executeBookingFeedAction(
  actorId: string,
  command: BookingFeedCommand,
  csrf: string | null,
): Promise<BookingFeedResult> {
  return invokeAction("features/assets/bookings/feedWebActions.executeBookingFeedAction", [
    actorId,
    command,
    csrf,
  ]);
}
