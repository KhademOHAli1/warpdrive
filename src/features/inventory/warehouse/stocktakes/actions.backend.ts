import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { StocktakeCommandResult } from "./contracts";
import { runStocktakeCommand } from "./service";

export async function executeStocktakeAction(
  expectedActorId: string,
  command: unknown,
  csrf: string | null,
): Promise<StocktakeCommandResult> {
  if (!(await guardCsrf(csrf)).ok) return { ok: false, error: "unavailable" };
  const { actor, db, session } = await createContext();
  if (actor === null || session === null || actor.id !== expectedActorId) {
    return { ok: false, error: "unavailable" };
  }
  return runStocktakeCommand(db, session, command, AbortSignal.timeout(15_000));
}
