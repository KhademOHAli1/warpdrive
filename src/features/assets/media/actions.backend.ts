import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { AssetMediaResult } from "./contracts";
import { readAssetMediaWorkspace, selectAssetMediaCover } from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;

async function currentSession(expectedActorId: string, csrf: string | null) {
  if (!(await guardCsrf(csrf)).ok) return null;
  const { actor, db, session, projectGuest } = await createContext();
  if (
    session === null ||
    actor?.isActive !== true ||
    actor.id !== expectedActorId ||
    projectGuest !== undefined
  )
    return null;
  return { db, session };
}

export async function readAssetMediaAction(
  expectedActorId: string,
  raw: unknown,
  csrf: string | null,
): Promise<AssetMediaResult> {
  const current = await currentSession(expectedActorId, csrf);
  if (current === null) return unavailable;
  return readAssetMediaWorkspace(current.db, current.session, raw, AbortSignal.timeout(15_000));
}

export async function selectAssetMediaCoverAction(
  expectedActorId: string,
  raw: unknown,
  csrf: string | null,
): Promise<AssetMediaResult> {
  const current = await currentSession(expectedActorId, csrf);
  if (current === null) return unavailable;
  return selectAssetMediaCover(current.db, current.session, raw, AbortSignal.timeout(20_000));
}
