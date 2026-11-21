import type { Db } from "@/db/client";
import type { AssetSite, AssetsWorkspace } from "./contracts";
import { custodyWorkspace } from "./custody/repository";
import { kitWorkspace } from "./kits/repository";
import { assetRegisterData } from "./repository";

export async function projectAssetsWorkspace(tx: Db, sites: AssetSite[]): Promise<AssetsWorkspace> {
  const siteIds = sites.map(({ id }) => id);
  const assets = await assetRegisterData(tx, siteIds, true);
  if (sites.length === 0) return { ...assets, sites };
  const custody = await custodyWorkspace(tx, sites, true);
  const kits = await kitWorkspace(tx, siteIds, true);
  return { ...assets, sites, custody, kits };
}
