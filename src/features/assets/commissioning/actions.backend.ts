import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { CommissionAssetResult } from "./contracts";
import { runCommissionAssetCommand } from "./service";

export async function executeCommissionAssetAction(
  expectedActorId: string,
  command: unknown,
  csrf: string | null,
): Promise<CommissionAssetResult> {
  if (!(await guardCsrf(csrf)).ok) return { ok: false, error: "unavailable" };
  const { actor, db, session } = await createContext();
  if (actor?.id !== expectedActorId || session === null) return { ok: false, error: "unavailable" };
  return runCommissionAssetCommand(db, session, command, AbortSignal.timeout(20_000));
}
