"use server";

import { invokeAction } from "@/frontend/actions";
import type {
  BookingHandoverCommand,
  BookingHandoverLookup,
  BookingHandoverRead,
  BookingHandoverWrite,
} from "./contracts";

export async function readHandoverAction(
  expectedActorId: string,
  bookingId: string,
  csrf: string | null,
): Promise<BookingHandoverRead> {
  return invokeAction("features/assets/bookings/handover/webActions.readHandoverAction", [
    expectedActorId,
    bookingId,
    csrf,
  ]);
}

export async function executeHandoverAction(
  expectedActorId: string,
  command: BookingHandoverCommand,
  csrf: string | null,
): Promise<BookingHandoverWrite> {
  return invokeAction("features/assets/bookings/handover/webActions.executeHandoverAction", [
    expectedActorId,
    command,
    csrf,
  ]);
}

export async function lookupHandoverAction(
  expectedActorId: string,
  bookingId: string,
  code: string,
  csrf: string | null,
): Promise<BookingHandoverLookup> {
  return invokeAction("features/assets/bookings/handover/webActions.lookupHandoverAction", [
    expectedActorId,
    bookingId,
    code,
    csrf,
  ]);
}
