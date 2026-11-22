import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { BookingAvailabilityResult, BookingResult } from "./contracts";
import { checkBookingAvailability, runBookingCommand } from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;

async function currentSession(expectedActorId: string, csrf: string | null) {
  if (!(await guardCsrf(csrf)).ok) return null;
  const { actor, db, session } = await createContext();
  return actor?.id === expectedActorId && session !== null ? { db, session } : null;
}

export async function executeBookingAction(
  expectedActorId: string,
  command: unknown,
  csrf: string | null,
): Promise<BookingResult> {
  const current = await currentSession(expectedActorId, csrf);
  return current === null
    ? unavailable
    : runBookingCommand(current.db, current.session, command, AbortSignal.timeout(20_000));
}

export async function checkAvailabilityAction(
  expectedActorId: string,
  input: unknown,
  csrf: string | null,
): Promise<BookingAvailabilityResult> {
  const current = await currentSession(expectedActorId, csrf);
  return current === null
    ? unavailable
    : checkBookingAvailability(current.db, current.session, input, AbortSignal.timeout(15_000));
}
