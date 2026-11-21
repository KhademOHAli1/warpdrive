import { requireFreshIdentityAction } from "@/features/identity/actions/fresh";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { OperationsAccessResult } from "./contracts";
import { executeOperationsAccessCommand } from "./service";

export async function executeOperationsAccessAction(
  expectedActorId: string,
  command: unknown,
  csrf: string | null,
): Promise<OperationsAccessResult> {
  if (!(await guardCsrf(csrf)).ok) return { ok: false, error: "unavailable" };
  const { actor, db, session } = await createContext();
  if (actor?.type !== "admin" || actor.id !== expectedActorId || session === null) {
    return { ok: false, error: "unavailable" };
  }
  if (!(await requireFreshIdentityAction()).ok) return { ok: false, error: "freshAuth" };
  return executeOperationsAccessCommand(db, session, command, AbortSignal.timeout(15_000));
}
