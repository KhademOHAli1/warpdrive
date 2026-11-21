import { and, eq, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { inventoryStockTransfers } from "./schema";

/** Caller holds the directory write lock, shared by transfer mutations. */
export async function hasOpenWarehouseTransfer(tx: Db, siteId: string, locationId: string | null) {
  const endpoint = or(
    and(
      eq(inventoryStockTransfers.sourceSiteId, siteId),
      locationId === null ? undefined : eq(inventoryStockTransfers.sourceLocationId, locationId),
    ),
    and(
      eq(inventoryStockTransfers.destinationSiteId, siteId),
      locationId === null
        ? undefined
        : eq(inventoryStockTransfers.destinationLocationId, locationId),
    ),
  );
  const [transfer] = await tx
    .select({ id: inventoryStockTransfers.id })
    .from(inventoryStockTransfers)
    .where(and(eq(inventoryStockTransfers.status, "in_transit"), endpoint))
    .limit(1);
  return transfer !== undefined;
}
