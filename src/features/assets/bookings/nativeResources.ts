import type { Db } from "@/db/client";
import type { AssetSite } from "../contracts";
import { custodyWorkspace } from "../custody/repository";
import { kitWorkspace } from "../kits/repository";
import { assetRegisterData } from "../repository";

export async function nativeBookingAssets(tx: Db, sites: AssetSite[]) {
  const ids = sites.map(({ id }) => id);
  const data = await assetRegisterData(tx, ids, false);
  const custody = await custodyWorkspace(tx, sites, false);
  const kits = await kitWorkspace(tx, ids, false);
  return { ...data, sites, custody, kits };
}
