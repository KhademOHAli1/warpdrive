import { and, eq, exists, isNull, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { assetBalances, assetRecords } from "./schema";

/** The caller holds the directory write lock, which serializes archive against placements. */
export async function hasActiveAssetPlacement(
  tx: Db,
  siteId: string,
  locationId: string | null,
): Promise<boolean> {
  const placement =
    locationId === null
      ? undefined
      : or(
          eq(assetRecords.locationId, locationId),
          exists(
            tx
              .select({ assetId: assetBalances.assetId })
              .from(assetBalances)
              .where(
                and(
                  eq(assetBalances.assetId, assetRecords.id),
                  eq(assetBalances.siteId, siteId),
                  eq(assetBalances.locationId, locationId),
                ),
              ),
          ),
        );
  const [record] = await tx
    .select({ id: assetRecords.id })
    .from(assetRecords)
    .where(and(eq(assetRecords.siteId, siteId), isNull(assetRecords.archivedAt), placement))
    .limit(1);
  return record !== undefined;
}
