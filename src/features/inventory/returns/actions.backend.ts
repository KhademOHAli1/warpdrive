import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { ReturnEffect } from "./contracts";
import { runReturnCommand } from "./service";

export async function executeReturnAction(
  expectedActorId: string,
  raw: unknown,
  csrf: string | null,
): Promise<ReturnEffect> {
  if (!(await guardCsrf(csrf)).ok) return { ok: false, error: "unavailable" };
  const { actor, db, session } = await createContext();
  if (actor?.id !== expectedActorId || session === null) return { ok: false, error: "unavailable" };
  return runReturnCommand(db, session, raw, AbortSignal.timeout(20_000));
}
