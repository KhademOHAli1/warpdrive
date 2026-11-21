import { and, eq, exists, gt, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  assetKitCheckoutLines,
  assetKitCheckouts,
  assetKitMembers,
  assetKits,
} from "./kits/schema";
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
  if (record !== undefined) return true;
  const [kit] = await tx
    .select({ id: assetKits.id })
    .from(assetKits)
    .where(
      and(
        eq(assetKits.siteId, siteId),
        locationId === null ? undefined : eq(assetKits.locationId, locationId),
        or(
          exists(
            tx
              .select({ id: assetKitMembers.id })
              .from(assetKitMembers)
              .where(
                and(eq(assetKitMembers.kitId, assetKits.id), gt(assetKitMembers.packedQuantity, 0)),
              ),
          ),
          exists(
            tx
              .select({ id: assetKitCheckoutLines.id })
              .from(assetKitCheckoutLines)
              .innerJoin(
                assetKitCheckouts,
                eq(assetKitCheckoutLines.checkoutId, assetKitCheckouts.id),
              )
              .where(
                and(
                  eq(assetKitCheckouts.kitId, assetKits.id),
                  isNull(assetKitCheckouts.closedAt),
                  sql`${assetKitCheckoutLines.returned} + ${assetKitCheckoutLines.consumed} < ${assetKitCheckoutLines.quantity}`,
                ),
              ),
          ),
        ),
      ),
    )
    .limit(1);
  return kit !== undefined;
}
