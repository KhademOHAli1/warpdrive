import type { Db } from "@/db/client";
import type { OperationsGrant } from "@/features/operations-access/contracts";
import { readOperationsSiteGrants } from "@/features/operations-access/scope";
import type { HydratedActor } from "@/server/hydrateActor";

export function assetRoleSiteIds(grants: readonly OperationsGrant[]): string[] {
  return grants.flatMap(({ siteId, role }) =>
    role === "asset_viewer" || role === "asset_manager" ? [siteId] : [],
  );
}

export async function canBrowseAssets(db: Db, actor: HydratedActor): Promise<boolean> {
  if (!actor.isActive || actor.projectsGuestOnly === true) return false;
  if (actor.type === "admin") return true;
  return assetRoleSiteIds(await readOperationsSiteGrants(db, actor.id)).length > 0;
}
