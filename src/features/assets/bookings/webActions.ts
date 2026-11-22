"use server";

import { invokeAction } from "@/frontend/actions";
import type {
  BookingAvailabilityInput,
  BookingAvailabilityResult,
  BookingCommand,
  BookingResult,
} from "./contracts";

export async function executeBookingAction(
  expectedActorId: string,
  input: BookingCommand,
  csrf: string | null,
): Promise<BookingResult> {
  return invokeAction("features/assets/bookings/webActions.executeBookingAction", [
    expectedActorId,
    input,
    csrf,
  ]);
}

export async function checkAvailabilityAction(
  expectedActorId: string,
  input: BookingAvailabilityInput,
  csrf: string | null,
): Promise<BookingAvailabilityResult> {
  return invokeAction("features/assets/bookings/webActions.checkAvailabilityAction", [
    expectedActorId,
    input,
    csrf,
  ]);
}
