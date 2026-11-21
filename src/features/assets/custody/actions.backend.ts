import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { CustodyResult } from "./contracts";
import { runAssetCustodyCommand } from "./service";

export async function executeCustodyAction(
  expectedActorId: string,
  command: unknown,
  csrf: string | null,
): Promise<CustodyResult> {
  if (!(await guardCsrf(csrf)).ok) return { ok: false, error: "unavailable" };
  const { actor, db, session } = await createContext();
  if (actor?.id !== expectedActorId || session === null) return { ok: false, error: "unavailable" };
  return runAssetCustodyCommand(db, session, command, AbortSignal.timeout(20_000));
}
