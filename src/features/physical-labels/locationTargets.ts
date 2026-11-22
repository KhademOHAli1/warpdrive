import { and, asc, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { directoryLocations } from "@/features/locations/schema";
import { readDirectorySiteScope } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import type { LabelTarget, LabelTargetRef } from "./contracts";

/** Uses the directory's site grants without returning its grant roster or other modules' data. */
export async function readLocationLabelTargets(
  tx: Db,
  actor: HydratedActor,
  refs?: readonly LabelTargetRef[],
): Promise<LabelTarget[]> {
  if (!actor.isActive || actor.projectsGuestOnly === true) return [];
  const ids = refs?.filter(({ kind }) => kind === "location").map(({ id }) => id);
  if (ids?.length === 0) return [];

  const { sites, managedSiteIds } = await readDirectorySiteScope(
    tx,
    actor.id,
    actor.type === "admin",
  );
  if (sites.length === 0) return [];
  const sitesById = new Map(sites.map((site) => [site.id, site]));
  const managed = new Set(managedSiteIds);
  const locations = await tx
    .select({
      id: directoryLocations.id,
      siteId: directoryLocations.siteId,
      title: directoryLocations.name,
      code: directoryLocations.code,
      archived: directoryLocations.archived,
    })
    .from(directoryLocations)
    .where(
      and(
        inArray(directoryLocations.siteId, [...sitesById.keys()]),
        ids === undefined ? undefined : inArray(directoryLocations.id, ids),
      ),
    )
    .orderBy(
      asc(directoryLocations.siteId),
      asc(directoryLocations.code),
      asc(directoryLocations.id),
    );
  return locations.flatMap(({ id, siteId, title, code, archived }): LabelTarget[] => {
    const site = sitesById.get(siteId);
    if (site === undefined) return [];
    return [
      {
        id,
        kind: "location",
        title,
        subtitle: `${code} · ${site.name}`,
        href: null,
        canManage: managed.has(siteId) && !site.archived && !archived,
      },
    ];
  });
}
