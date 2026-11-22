import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import { assetModels, assetRecords } from "../schema";
import { assetActor, assetSites, lockAssetRegister } from "../service";
import type { AssetMediaTarget } from "./contracts";

export const assetMediaUnavailable = { ok: false, error: "unavailable" } as const;
class AssetMediaSessionExpired extends Error {}

export async function withAssetMediaAuthority<T>(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
  run: (tx: Db, actor: HydratedActor) => Promise<T>,
): Promise<T | typeof assetMediaUnavailable> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockDirectory(tx, "read", signal);
      const actor = await assetActor(tx, who, signal);
      if (actor === null) return assetMediaUnavailable;
      await lockAssetRegister(tx, "read", signal);
      const result = await run(tx, actor);
      if ((await assetActor(tx, who, signal)) === null) throw new AssetMediaSessionExpired();
      return result;
    });
  } catch (error) {
    if (error instanceof AssetMediaSessionExpired) return assetMediaUnavailable;
    throw error;
  }
}

export async function readAssetMediaOwner(tx: Db, actor: HydratedActor, target: AssetMediaTarget) {
  const sites = await assetSites(tx, actor);
  const siteIds = sites.map(({ id }) => id);
  if (siteIds.length === 0) return null;
  if (target.type === "model") {
    const [model] = await tx
      .select({ siteId: assetModels.siteId })
      .from(assetModels)
      .where(and(eq(assetModels.id, target.id), inArray(assetModels.siteId, siteIds)));
    return model === undefined
      ? null
      : {
          siteId: model.siteId,
          canManage: sites.some(({ id, canManage }) => id === model.siteId && canManage),
          modelId: null,
        };
  }
  const [asset] = await tx
    .select({
      siteId: assetRecords.siteId,
      modelId: assetRecords.modelId,
      archivedAt: assetRecords.archivedAt,
    })
    .from(assetRecords)
    .where(and(eq(assetRecords.id, target.id), inArray(assetRecords.siteId, siteIds)));
  return asset === undefined
    ? null
    : {
        siteId: asset.siteId,
        canManage:
          asset.archivedAt === null &&
          sites.some(({ id, canManage }) => id === asset.siteId && canManage),
        modelId: asset.modelId,
      };
}

export type AssetMediaOwner = NonNullable<Awaited<ReturnType<typeof readAssetMediaOwner>>>;
