import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { BookingFeedResult } from "./feedContracts";
import { runBookingFeedCommand } from "./feedService";

export async function executeBookingFeedAction(
  expectedActorId: string,
  command: unknown,
  csrf: string | null,
): Promise<BookingFeedResult> {
  if (!(await guardCsrf(csrf)).ok) return { ok: false, error: "unavailable" };
  const { actor, db, session } = await createContext();
  if (actor?.id !== expectedActorId || session === null) return { ok: false, error: "unavailable" };
  return runBookingFeedCommand(db, session, command, AbortSignal.timeout(15_000));
}
