import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { assetSites } from "@/features/assets/service";
import type { WarehouseAccess } from "@/features/inventory/warehouse/access";
import { stockPositionAvailable } from "@/features/inventory/warehouse/balances";
import type { WarehouseLocation, WarehouseSite } from "@/features/inventory/warehouse/contracts";
import type { Position } from "@/features/inventory/warehouse/operations/shared";
import {
  inventoryStockInstallations,
  inventoryStockTransferLines,
  inventoryStockTransfers,
} from "@/features/inventory/warehouse/schema";
import type { HydratedActor } from "@/server/hydrateActor";
import type { CommissionAssetIntent } from "./contracts";

export async function commissioningSiteIds(
  tx: Db,
  actor: HydratedActor,
  warehouse: WarehouseAccess,
): Promise<string[]> {
  const warehouseSites = new Set(
    warehouse.sites.filter(({ archived, canManage }) => !archived && canManage).map(({ id }) => id),
  );
  if (warehouseSites.size === 0) return [];
  return (await assetSites(tx, actor))
    .filter(({ id, canManage }) => warehouseSites.has(id) && canManage)
    .map(({ id }) => id);
}

export function matchingPosition(position: Position, intent: CommissionAssetIntent): boolean {
  return (
    position.siteId === intent.siteId &&
    position.locationId === intent.locationId &&
    position.serial === intent.serial &&
    position.lot === intent.lot
  );
}

export async function eligiblePosition(
  tx: Db,
  position: Position,
  site: WarehouseSite,
  location: WarehouseLocation,
) {
  if (position.serial === null || position.onHand !== 1 || position.reserved !== 0) return false;
  const available = stockPositionAvailable({
    ...position,
    siteArchived: site.archived,
    locationArchived: location.archived,
    locationKind: location.kind,
  });
  if (available !== 1) return false;
  const [assembly] = await tx
    .select({ id: inventoryStockInstallations.id })
    .from(inventoryStockInstallations)
    .where(
      and(
        isNull(inventoryStockInstallations.removedEventId),
        or(
          eq(inventoryStockInstallations.assemblyPositionId, position.id),
          eq(inventoryStockInstallations.componentPositionId, position.id),
        ),
      ),
    )
    .limit(1);
  if (assembly !== undefined) return false;
  const [transfer] = await tx
    .select({ id: inventoryStockTransferLines.id })
    .from(inventoryStockTransferLines)
    .innerJoin(
      inventoryStockTransfers,
      eq(inventoryStockTransfers.id, inventoryStockTransferLines.transferId),
    )
    .where(
      and(
        eq(inventoryStockTransferLines.sourcePositionId, position.id),
        inArray(inventoryStockTransfers.status, ["draft", "in_transit"]),
      ),
    )
    .limit(1);
  return transfer === undefined;
}
