import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { KitResult } from "./contracts";
import { runKitCommand } from "./service";

export async function executeKitAction(
  expectedActorId: string,
  command: unknown,
  csrf: string | null,
): Promise<KitResult> {
  if (!(await guardCsrf(csrf)).ok) return { ok: false, error: "unavailable" };
  const { actor, db, session } = await createContext();
  if (actor?.id !== expectedActorId || session === null) return { ok: false, error: "unavailable" };
  return runKitCommand(db, session, command, AbortSignal.timeout(20_000));
}
