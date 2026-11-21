import { asc, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { directorySites } from "@/features/locations/schema";
import {
  operationsSiteCapabilities,
  readOperationsSiteGrants,
} from "@/features/operations-access/scope";
import type { OperationsActor } from "../operations/shared";
import type { StocktakeSite } from "./contracts";

export async function readStocktakeSites(tx: Db, actor: OperationsActor): Promise<StocktakeSite[]> {
  const grants = actor.access.isAdmin ? [] : await readOperationsSiteGrants(tx, actor.id);
  const warehouseSites = new Map(actor.access.sites.map((site) => [site.id, site]));
  const costSites = grants.filter(({ role }) => role === "cost_viewer").map(({ siteId }) => siteId);
  const sites = await tx
    .select({
      id: directorySites.id,
      code: directorySites.code,
      name: directorySites.name,
      archived: directorySites.archived,
    })
    .from(directorySites)
    .where(
      actor.access.isAdmin
        ? undefined
        : inArray(directorySites.id, [...warehouseSites.keys(), ...costSites]),
    )
    .orderBy(asc(directorySites.code), asc(directorySites.id));
  return sites.map((site) => {
    const canCount =
      !site.archived && (actor.access.isAdmin || warehouseSites.get(site.id)?.canManage === true);
    const { canViewCosts } = operationsSiteCapabilities(grants, actor.access.isAdmin, site.id);
    return {
      ...site,
      canReadCounts: actor.access.isAdmin || warehouseSites.has(site.id),
      canCount,
      canReadValues: canViewCosts,
      canCaptureValues: canCount && canViewCosts,
    };
  });
}
