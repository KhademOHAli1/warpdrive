import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { AssetResult } from "./contracts";
import { runAssetCommand } from "./service";

export async function executeAssetAction(
  expectedActorId: string,
  command: unknown,
  csrf: string | null,
): Promise<AssetResult> {
  if (!(await guardCsrf(csrf)).ok) return { ok: false, error: "unavailable" };
  const { actor, db, session } = await createContext();
  if (actor?.id !== expectedActorId || session === null) return { ok: false, error: "unavailable" };
  return runAssetCommand(db, session, command, AbortSignal.timeout(20_000));
}
