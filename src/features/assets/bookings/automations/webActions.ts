"use server";

import { invokeAction } from "@/frontend/actions";
import type {
  BookingAutomationProfile,
  BookingAutomationProfileInput,
  BookingAutomationResult,
  BookingAutomationRetryInput,
  BookingAutomationRun,
} from "./contracts";

export async function saveBookingAutomationProfileAction(
  actorId: string,
  input: BookingAutomationProfileInput,
  csrf: string | null,
): Promise<BookingAutomationResult<BookingAutomationProfile>> {
  return invokeAction(
    "features/assets/bookings/automations/webActions.saveBookingAutomationProfileAction",
    [actorId, input, csrf],
  );
}

export async function retryBookingAutomationRunAction(
  actorId: string,
  input: BookingAutomationRetryInput,
  csrf: string | null,
): Promise<BookingAutomationResult<BookingAutomationRun>> {
  return invokeAction(
    "features/assets/bookings/automations/webActions.retryBookingAutomationRunAction",
    [actorId, input, csrf],
  );
}
