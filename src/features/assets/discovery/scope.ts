import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import type { AssetSite } from "../contracts";
import { assetActor, assetSites, lockAssetRegister } from "../service";

export const assetDiscoveryUnavailable = { ok: false, error: "unavailable" } as const;
class AssetDiscoverySessionExpired extends Error {}

export async function withAssetDiscoveryAuthority<T>(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
  mode: "read" | "write",
  operation: (tx: Db, actor: HydratedActor, sites: AssetSite[]) => Promise<T>,
): Promise<T | typeof assetDiscoveryUnavailable> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockDirectory(tx, "read", signal);
      const actor = await assetActor(tx, who, signal);
      if (actor === null) return assetDiscoveryUnavailable;
      await lockAssetRegister(tx, mode, signal);
      const sites = await assetSites(tx, actor);
      if (sites.length === 0) return assetDiscoveryUnavailable;
      const result = await operation(tx, actor, sites);
      if ((await assetActor(tx, who, signal)) === null) throw new AssetDiscoverySessionExpired();
      return result;
    });
  } catch (error) {
    if (error instanceof AssetDiscoverySessionExpired) return assetDiscoveryUnavailable;
    throw error;
  }
}

export async function lockAssetDiscoveryRequests(tx: Db, actorId: string, signal: AbortSignal) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('asset-discovery-owner'), hashtext(${actorId}))`,
  );
  signal.throwIfAborted();
}
