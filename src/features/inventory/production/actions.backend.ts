import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { ProductionEffect } from "./contracts";
import { runProductionCommand } from "./service";

export async function executeProductionAction(
  expectedActorId: string,
  command: unknown,
  csrf: string | null,
): Promise<ProductionEffect> {
  if (!(await guardCsrf(csrf)).ok) return { ok: false, error: "unavailable" };
  const { actor, db, session } = await createContext();
  if (actor?.id !== expectedActorId || session === null) return { ok: false, error: "unavailable" };
  return runProductionCommand(db, session, command, AbortSignal.timeout(20_000));
}
