import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import type { HydratedActor } from "@/server/hydrateActor";
import type { AssetSite, AssetsWorkspace } from "../contracts";
import { projectAssetsWorkspace } from "../projection";
import { assetRegisterData, persistAssetChanges } from "../repository";
import { permitsAssetIdentityUpdate, preservesAssetBookings } from "../service";
import { applyAssetRegisterBatch, assetRegisterBatchInput } from "./batch";
import type { AssetRegisterBatchInput, AssetRegisterBatchResult } from "./contracts";
import {
  assetDiscoveryFingerprint,
  persistAssetDiscoveryReceipt,
  readAssetDiscoveryReceipt,
} from "./repository";
import {
  assetDiscoveryUnavailable,
  lockAssetDiscoveryRequests,
  withAssetDiscoveryAuthority,
} from "./scope";

const invalid = { ok: false, error: "invalid" } as const;
const conflict = { ok: false, error: "conflict" } as const;

async function applyBatch(
  tx: Db,
  actor: HydratedActor,
  sites: AssetSite[],
  input: AssetRegisterBatchInput,
  signal: AbortSignal,
): Promise<AssetRegisterBatchResult> {
  const site = sites.find(({ id, canManage }) => id === input.siteId && canManage);
  if (site === undefined) return assetDiscoveryUnavailable;
  await lockAssetDiscoveryRequests(tx, actor.id, signal);
  const fingerprint = assetDiscoveryFingerprint(input);
  const previous = await readAssetDiscoveryReceipt(tx, actor.id, input.requestId);
  if (previous !== undefined) {
    if (
      previous.siteId !== site.id ||
      previous.kind !== "batch" ||
      previous.fingerprint !== fingerprint ||
      previous.outcomes === null
    )
      return conflict;
    return {
      ok: true,
      workspace: await projectAssetsWorkspace(tx, sites),
      outcomes: previous.outcomes,
    };
  }

  const initial: AssetsWorkspace = {
    sites: [site],
    ...(await assetRegisterData(tx, [site.id], false)),
  };
  const result = await applyAssetRegisterBatch(initial, input, actor.name, {
    checkUpdate: async ({ command, record, before, after }) => {
      signal.throwIfAborted();
      if (!(await permitsAssetIdentityUpdate(tx, command, before.records))) return false;
      if (record.tracking !== "individual" || record.modelId === command.modelId) return true;
      return preservesAssetBookings(tx, site, before, after);
    },
  });
  if (!result.ok) return result;
  signal.throwIfAborted();
  await persistAssetChanges(tx, initial, result.workspace, actor.id);
  await persistAssetDiscoveryReceipt(tx, {
    actorId: actor.id,
    requestId: input.requestId,
    siteId: site.id,
    kind: "batch",
    fingerprint,
    outcomes: result.outcomes,
  });
  return {
    ok: true,
    workspace: await projectAssetsWorkspace(tx, sites),
    outcomes: result.outcomes,
  };
}

export async function runAssetRegisterBatch(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<AssetRegisterBatchResult> {
  const parsed = assetRegisterBatchInput.safeParse(raw);
  if (!parsed.success) return invalid;
  return withAssetDiscoveryAuthority(db, who, signal, "write", (tx, actor, sites) =>
    applyBatch(tx, actor, sites, parsed.data, signal),
  );
}
