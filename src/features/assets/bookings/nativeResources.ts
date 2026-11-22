import type { Db } from "@/db/client";
import { custodyWorkspace } from "../custody/repository";
import { kitWorkspace } from "../kits/repository";
import { assetRegisterData } from "../repository";
import { assetBookingSources } from "./resources";

export async function nativeBookingResources(tx: Db, siteIds: string[]) {
  const sites = siteIds.map((id) => ({ id, name: "", code: "", canManage: false }));
  const data = await assetRegisterData(tx, siteIds, false);
  const custody = await custodyWorkspace(tx, sites, false);
  const kits = await kitWorkspace(tx, siteIds, false);
  return assetBookingSources({ ...data, sites, custody, kits });
}
