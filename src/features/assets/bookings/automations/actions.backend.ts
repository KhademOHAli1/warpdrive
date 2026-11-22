import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type {
  BookingAutomationProfile,
  BookingAutomationResult,
  BookingAutomationRun,
} from "./contracts";
import { retryBookingAutomationRun, saveBookingAutomationProfile } from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;

async function currentSession(expectedActorId: string, csrf: string | null) {
  if (!(await guardCsrf(csrf)).ok) return null;
  const { actor, db, session } = await createContext();
  return actor?.id === expectedActorId && session !== null ? { db, session } : null;
}

export async function saveBookingAutomationProfileAction(
  actorId: string,
  input: unknown,
  csrf: string | null,
): Promise<BookingAutomationResult<BookingAutomationProfile>> {
  const current = await currentSession(actorId, csrf);
  return current === null
    ? unavailable
    : saveBookingAutomationProfile(current.db, current.session, input, AbortSignal.timeout(15_000));
}

export async function retryBookingAutomationRunAction(
  actorId: string,
  input: unknown,
  csrf: string | null,
): Promise<BookingAutomationResult<BookingAutomationRun>> {
  const current = await currentSession(actorId, csrf);
  return current === null
    ? unavailable
    : retryBookingAutomationRun(current.db, current.session, input, AbortSignal.timeout(20_000));
}
