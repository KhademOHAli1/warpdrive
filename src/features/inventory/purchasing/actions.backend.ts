import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { PurchasingCommandResult } from "./contracts";
import { runPurchasingCommand } from "./service";

export async function executePurchasingAction(
  expectedActorId: string,
  command: unknown,
  csrf: string | null,
): Promise<PurchasingCommandResult> {
  if (typeof csrf !== "string" || !(await guardCsrf(csrf)).ok) {
    return { ok: false, error: "unavailable" };
  }
  const { actor, session, db } = await createContext();
  if (actor === null || session === null || actor.id !== expectedActorId) {
    return { ok: false, error: "unavailable" };
  }
  return runPurchasingCommand(db, session, command, AbortSignal.timeout(20_000));
}
