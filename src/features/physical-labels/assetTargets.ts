import { and, asc, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { assetKits } from "@/features/assets/kits/schema";
import { assetRecords } from "@/features/assets/schema";
import { assetSites } from "@/features/assets/service";
import type { HydratedActor } from "@/server/hydrateActor";
import type { LabelTarget, LabelTargetRef } from "./contracts";

/** Resolves only records visible under the caller's directory and Assets register locks. */
export async function readAssetLabelTargets(
  tx: Db,
  actor: HydratedActor,
  refs?: readonly LabelTargetRef[],
): Promise<LabelTarget[]> {
  if (!actor.isActive || actor.projectsGuestOnly === true) return [];
  const assetIds = refs?.filter(({ kind }) => kind === "asset").map(({ id }) => id);
  const kitIds = refs?.filter(({ kind }) => kind === "kit").map(({ id }) => id);
  if (assetIds?.length === 0 && kitIds?.length === 0) return [];

  const sites = await assetSites(tx, actor);
  if (sites.length === 0) return [];
  const siteIds = sites.map(({ id }) => id);
  const sitesById = new Map(sites.map((site) => [site.id, site]));
  const assets =
    assetIds?.length === 0
      ? []
      : await tx
          .select({
            id: assetRecords.id,
            siteId: assetRecords.siteId,
            title: assetRecords.name,
            code: assetRecords.code,
            archivedAt: assetRecords.archivedAt,
          })
          .from(assetRecords)
          .where(
            and(
              inArray(assetRecords.siteId, siteIds),
              assetIds === undefined ? undefined : inArray(assetRecords.id, assetIds),
            ),
          )
          .orderBy(asc(assetRecords.code), asc(assetRecords.id));
  const kits =
    kitIds?.length === 0
      ? []
      : await tx
          .select({
            id: assetKits.id,
            siteId: assetKits.siteId,
            title: assetKits.name,
            code: assetKits.code,
          })
          .from(assetKits)
          .where(
            and(
              inArray(assetKits.siteId, siteIds),
              kitIds === undefined ? undefined : inArray(assetKits.id, kitIds),
            ),
          )
          .orderBy(asc(assetKits.code), asc(assetKits.id));

  return [
    ...assets.map((asset) => ({ ...asset, kind: "asset" as const })),
    ...kits.map((kit) => ({ ...kit, kind: "kit" as const, archivedAt: null })),
  ].flatMap(({ id, siteId, code, title, kind, archivedAt }): LabelTarget[] => {
    const site = sitesById.get(siteId);
    if (site === undefined) return [];
    return [
      {
        id,
        kind,
        title,
        subtitle: `${code} · ${site.name}`,
        href: kind === "asset" ? `/assets?assetId=${id}` : null,
        canManage: site.canManage && archivedAt === null,
      },
    ];
  });
}
