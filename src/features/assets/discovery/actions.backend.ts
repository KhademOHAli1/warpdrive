import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import { runAssetRegisterBatch } from "./batchService";
import type { AssetRegisterBatchResult, AssetRegisterViewsResult } from "./contracts";
import { readAssetRegisterViews, removeAssetRegisterView, saveAssetRegisterView } from "./views";

const unavailable = { ok: false, error: "unavailable" } as const;

async function withCaller<T>(
  expectedActorId: string,
  csrf: string | null,
  timeoutMs: number,
  command: (db: Db, session: NativeSessionRef, signal: AbortSignal) => Promise<T>,
): Promise<T | typeof unavailable> {
  if (!(await guardCsrf(csrf)).ok) return unavailable;
  const { actor, db, session, projectGuest } = await createContext();
  if (
    session === null ||
    actor?.isActive !== true ||
    actor.id !== expectedActorId ||
    projectGuest !== undefined
  )
    return unavailable;
  return command(db, session, AbortSignal.timeout(timeoutMs));
}

export async function readAssetRegisterViewsAction(
  expectedActorId: string,
  csrf: string | null,
): Promise<AssetRegisterViewsResult> {
  return withCaller(expectedActorId, csrf, 15_000, readAssetRegisterViews);
}

export async function saveAssetRegisterViewAction(
  expectedActorId: string,
  raw: unknown,
  csrf: string | null,
): Promise<AssetRegisterViewsResult> {
  return withCaller(expectedActorId, csrf, 20_000, (db, session, signal) =>
    saveAssetRegisterView(db, session, raw, signal),
  );
}

export async function removeAssetRegisterViewAction(
  expectedActorId: string,
  raw: unknown,
  csrf: string | null,
): Promise<AssetRegisterViewsResult> {
  return withCaller(expectedActorId, csrf, 20_000, (db, session, signal) =>
    removeAssetRegisterView(db, session, raw, signal),
  );
}

export async function runAssetRegisterBatchAction(
  expectedActorId: string,
  raw: unknown,
  csrf: string | null,
): Promise<AssetRegisterBatchResult> {
  return withCaller(expectedActorId, csrf, 25_000, (db, session, signal) =>
    runAssetRegisterBatch(db, session, raw, signal),
  );
}
