import { requireFreshIdentityAction } from "@/features/identity/actions/fresh";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { BookingMembershipResult } from "./membershipContracts";
import { runBookingMembershipCommand } from "./membershipService";

const unavailable = { ok: false, error: "unavailable" } as const;

export async function executeBookingMembershipAction(
  expectedActorId: string,
  command: unknown,
  csrf: string | null,
): Promise<BookingMembershipResult> {
  if (!(await guardCsrf(csrf)).ok) return unavailable;
  const { actor, db, session } = await createContext();
  if (actor?.type !== "admin" || actor.id !== expectedActorId || session === null)
    return unavailable;
  if (!(await requireFreshIdentityAction()).ok) return { ok: false, error: "freshAuth" };
  return runBookingMembershipCommand(db, session, command, AbortSignal.timeout(15_000));
}
