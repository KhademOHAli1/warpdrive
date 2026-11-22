import { env } from "@/config/env";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { BookingHandoverLookup, BookingHandoverRead, BookingHandoverWrite } from "./contracts";
import { lookupBookingHandoverEquipment, readBookingHandover, runBookingHandover } from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;

async function currentSession(expectedActorId: string, csrf: string | null) {
  if (!(await guardCsrf(csrf)).ok) return null;
  const { actor, db, session } = await createContext();
  return actor?.id === expectedActorId && session !== null ? { db, session } : null;
}

export async function readHandoverAction(
  expectedActorId: string,
  bookingId: unknown,
  csrf: string | null,
): Promise<BookingHandoverRead> {
  const current = await currentSession(expectedActorId, csrf);
  return current === null
    ? unavailable
    : readBookingHandover(current.db, current.session, bookingId, AbortSignal.timeout(15_000));
}

export async function executeHandoverAction(
  expectedActorId: string,
  command: unknown,
  csrf: string | null,
): Promise<BookingHandoverWrite> {
  const current = await currentSession(expectedActorId, csrf);
  return current === null
    ? unavailable
    : runBookingHandover(current.db, current.session, command, AbortSignal.timeout(20_000));
}

export async function lookupHandoverAction(
  expectedActorId: string,
  bookingId: unknown,
  code: unknown,
  csrf: string | null,
): Promise<BookingHandoverLookup> {
  const current = await currentSession(expectedActorId, csrf);
  return current === null
    ? unavailable
    : lookupBookingHandoverEquipment(
        current.db,
        current.session,
        bookingId,
        code,
        new URL(env.BASE_URL).origin,
        AbortSignal.timeout(15_000),
      );
}
