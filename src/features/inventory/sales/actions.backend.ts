import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { SalesEffect } from "./contracts";
import { runSalesCommand } from "./service";

export async function executeSalesAction(
  expectedActorId: string,
  raw: unknown,
  csrf: string | null,
): Promise<SalesEffect> {
  if (!(await guardCsrf(csrf)).ok) return { ok: false, error: "unavailable" };
  const { actor, db, session } = await createContext();
  if (actor?.id !== expectedActorId || session === null) return { ok: false, error: "unavailable" };
  return runSalesCommand(db, session, raw, AbortSignal.timeout(20_000));
}
