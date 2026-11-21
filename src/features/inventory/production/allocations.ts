import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { canHoldInventory } from "../catalog/eligibility";
import { catalogItemPolicy } from "../catalog/policy";
import { lockInventoryStock } from "../stock";
import {
  earliestExpiryFirst,
  isStockPositionEligible,
  readStockPositionRows,
  stockPositionAvailable,
} from "../warehouse/balances";
import { readEligibleBuildOrigins } from "../warehouse/productionOrigin";
import { inventoryStockPositions } from "../warehouse/schema";
import type { ProductionBuildRow } from "./buildSchema";
import { failProduction } from "./failure";
import {
  inventoryProductionAllocations,
  inventoryProductionInputs,
  inventoryProductionMaterials,
} from "./materialSchema";
import {
  type ProductionPositionRow,
  type ProductionStockLocks,
  productionStockUnits,
  writeProductionStock,
} from "./stock";

export type ProductionMaterialRow = typeof inventoryProductionMaterials.$inferSelect;
type Allocation = typeof inventoryProductionAllocations.$inferSelect;
type MaterialStock = Pick<
  ProductionMaterialRow,
  "itemId" | "requiredReleaseId" | "stockUnit" | "consumable"
>;
type BuildAllocation = {
  allocation: Allocation;
  material: ProductionMaterialRow;
  position: ProductionPositionRow;
};

async function eligibleProductionPositions(
  tx: Db,
  siteId: string,
  material: MaterialStock,
  trackable: boolean,
) {
  const rows = (await readStockPositionRows(tx, [material.itemId], [siteId])).filter(
    (row) => row.onHand > 0 && (!trackable || row.serial !== null) && isStockPositionEligible(row),
  );
  if (material.requiredReleaseId === null || rows.length === 0) return rows;
  const origins = await readEligibleBuildOrigins(tx, siteId, [material.itemId]);
  return rows.filter(({ id }) => {
    const origin = origins.get(id);
    return (
      origin?.releaseId === material.requiredReleaseId && origin.stockUnit === material.stockUnit
    );
  });
}

async function materialStockPolicy(tx: Db, material: MaterialStock) {
  const catalog = await catalogItemPolicy(tx, material.itemId);
  if (catalog === null || !canHoldInventory(catalog))
    return { usable: false, trackable: false, unitMatches: true };
  const unit = (await productionStockUnits(tx, [material.itemId])).get(material.itemId) ?? "each";
  return {
    usable: true,
    trackable: catalog.flags.trackable,
    unitMatches: unit === material.stockUnit,
  };
}

/** Exact-release assembly stock excludes generic stock and manually modified assemblies. */
export async function availableProductionPositions(
  tx: Db,
  siteId: string,
  material: MaterialStock,
) {
  if (material.consumable) return [];
  const { usable, trackable, unitMatches } = await materialStockPolicy(tx, material);
  if (!usable || !unitMatches) return [];
  return (await eligibleProductionPositions(tx, siteId, material, trackable))
    .filter((position) => stockPositionAvailable(position) > 0)
    .sort(earliestExpiryFirst);
}

export function readBuildMaterials(tx: Db, buildId: string) {
  return tx
    .select()
    .from(inventoryProductionMaterials)
    .where(eq(inventoryProductionMaterials.buildId, buildId))
    .orderBy(asc(inventoryProductionMaterials.itemId), asc(inventoryProductionMaterials.id));
}

function materialAllocations(tx: Db, materialId: string) {
  return tx
    .select()
    .from(inventoryProductionAllocations)
    .where(eq(inventoryProductionAllocations.materialId, materialId));
}

export function readBuildAllocations(tx: Db, buildId: string): Promise<BuildAllocation[]> {
  return tx
    .select({
      allocation: inventoryProductionAllocations,
      material: inventoryProductionMaterials,
      position: inventoryStockPositions,
    })
    .from(inventoryProductionAllocations)
    .innerJoin(
      inventoryProductionMaterials,
      eq(inventoryProductionMaterials.id, inventoryProductionAllocations.materialId),
    )
    .innerJoin(
      inventoryStockPositions,
      eq(inventoryStockPositions.id, inventoryProductionAllocations.positionId),
    )
    .where(eq(inventoryProductionMaterials.buildId, buildId))
    .orderBy(
      asc(inventoryProductionAllocations.itemId),
      asc(inventoryProductionAllocations.positionId),
    );
}

function remainingMaterialDemand(build: ProductionBuildRow, material: ProductionMaterialRow) {
  return material.perUnit * (build.quantity - build.completed - build.scrapped);
}

async function reserveMaterial(
  tx: Db,
  actorId: string,
  requestId: string,
  stock: ProductionStockLocks,
  material: ProductionMaterialRow,
  position: ProductionPositionRow,
  quantity: number,
) {
  await writeProductionStock(tx, actorId, requestId, stock, "production-reserve", {
    position,
    onHandDelta: 0,
    reservedDelta: quantity,
  });
  await tx
    .insert(inventoryProductionAllocations)
    .values({ materialId: material.id, itemId: material.itemId, positionId: position.id, quantity })
    .onConflictDoUpdate({
      target: [
        inventoryProductionAllocations.materialId,
        inventoryProductionAllocations.positionId,
      ],
      set: { quantity: sql`${inventoryProductionAllocations.quantity} + excluded.quantity` },
    });
}

async function reduceAllocation(tx: Db, allocation: Allocation, used: number) {
  const target = and(
    eq(inventoryProductionAllocations.materialId, allocation.materialId),
    eq(inventoryProductionAllocations.positionId, allocation.positionId),
  );
  if (used === allocation.quantity) await tx.delete(inventoryProductionAllocations).where(target);
  else
    await tx
      .update(inventoryProductionAllocations)
      .set({ quantity: allocation.quantity - used })
      .where(target);
}

export async function autoAllocateProductionMaterial(
  tx: Db,
  actorId: string,
  requestId: string,
  build: ProductionBuildRow,
  material: ProductionMaterialRow,
  targetQuantity?: number,
) {
  if (material.consumable) return 0;
  const stock = await lockInventoryStock(tx, [material.itemId]);
  const { usable, trackable, unitMatches } = await materialStockPolicy(tx, material);
  if (!unitMatches) failProduction("unitChanged");
  if (!usable) return 0;
  const allocations = await materialAllocations(tx, material.id);
  const allocated = allocations.reduce((total, row) => total + row.quantity, 0);
  const goal = Math.min(
    targetQuantity ?? remainingMaterialDemand(build, material),
    remainingMaterialDemand(build, material),
  );
  let remaining = Math.max(0, goal - allocated);
  if (remaining === 0) return 0;
  let added = 0;
  const positions = (await eligibleProductionPositions(tx, build.siteId, material, trackable)).sort(
    earliestExpiryFirst,
  );
  for (const position of positions) {
    if (remaining === 0) break;
    const take = Math.min(stockPositionAvailable(position), remaining);
    if (take === 0) continue;
    await reserveMaterial(tx, actorId, requestId, stock, material, position, take);
    remaining -= take;
    added += take;
  }
  return added;
}

export async function changeBuildAllocation(
  tx: Db,
  actorId: string,
  build: ProductionBuildRow,
  command: {
    type: "allocate" | "deallocate";
    requestId: string;
    materialId: string;
    positionId: string;
    quantity: number;
  },
) {
  const [material] = await tx
    .select()
    .from(inventoryProductionMaterials)
    .where(
      and(
        eq(inventoryProductionMaterials.id, command.materialId),
        eq(inventoryProductionMaterials.buildId, build.id),
      ),
    );
  if (material === undefined || material.consumable) failProduction("unavailable");
  const stock = await lockInventoryStock(tx, [material.itemId]);
  if (command.type === "deallocate") {
    const row = (await readBuildAllocations(tx, build.id)).find(
      ({ allocation }) =>
        allocation.materialId === material.id && allocation.positionId === command.positionId,
    );
    if (row === undefined || row.position.siteId !== build.siteId) failProduction("unavailable");
    if (row.allocation.quantity < command.quantity) failProduction("stock");
    await releaseAllocation(tx, actorId, command.requestId, stock, row, command.quantity);
    return;
  }
  const { usable, trackable, unitMatches } = await materialStockPolicy(tx, material);
  if (!unitMatches) failProduction("unitChanged");
  if (!usable) failProduction("stock");
  const [position] = (
    await eligibleProductionPositions(tx, build.siteId, material, trackable)
  ).filter(({ id }) => id === command.positionId);
  if (position === undefined) failProduction("unavailable");
  const allocated = (await materialAllocations(tx, material.id)).reduce(
    (sum, row) => sum + row.quantity,
    0,
  );
  if (
    command.quantity >
    Math.min(stockPositionAvailable(position), remainingMaterialDemand(build, material) - allocated)
  ) {
    failProduction("stock");
  }
  await reserveMaterial(
    tx,
    actorId,
    command.requestId,
    stock,
    material,
    position,
    command.quantity,
  );
}

async function releaseAllocation(
  tx: Db,
  actorId: string,
  requestId: string,
  stock: ProductionStockLocks,
  { allocation, position }: BuildAllocation,
  quantity: number,
) {
  if (position.reserved < quantity) failProduction("stock");
  await writeProductionStock(tx, actorId, requestId, stock, "production-release", {
    position,
    onHandDelta: 0,
    reservedDelta: -quantity,
  });
  await reduceAllocation(tx, allocation, quantity);
}

export async function releaseAllBuildAllocations(
  tx: Db,
  actorId: string,
  requestId: string,
  build: ProductionBuildRow,
  stock: ProductionStockLocks,
) {
  const byId = new Map<string, ProductionPositionRow>();
  for (const row of await readBuildAllocations(tx, build.id)) {
    const position = byId.get(row.position.id) ?? row.position;
    if (position.siteId !== build.siteId) failProduction("unavailable");
    byId.set(position.id, position);
    await releaseAllocation(
      tx,
      actorId,
      requestId,
      stock,
      { ...row, position },
      row.allocation.quantity,
    );
  }
}

type BatchConsumption = {
  actorId: string;
  requestId: string;
  build: ProductionBuildRow;
  output: { id: string; quantity: number };
  stock: ProductionStockLocks;
};

async function consumeMaterial(
  tx: Db,
  { actorId, requestId, build, output, stock }: BatchConsumption,
  material: ProductionMaterialRow,
  allocations: Allocation[],
) {
  const { usable, trackable, unitMatches } = await materialStockPolicy(tx, material);
  if (!unitMatches) failProduction("unitChanged");
  if (!usable) failProduction("stock");

  const byPosition = new Map(allocations.map((allocation) => [allocation.positionId, allocation]));
  const eligible = (await eligibleProductionPositions(tx, build.siteId, material, trackable)).sort(
    earliestExpiryFirst,
  );
  let remaining = output.quantity * material.perUnit;
  for (const position of eligible) {
    if (remaining === 0) break;
    const allocation = byPosition.get(position.id);
    if (allocation === undefined) continue;

    const take = Math.min(allocation.quantity, remaining);
    if (take > position.reserved || take > position.onHand) failProduction("stock");
    const eventId = await writeProductionStock(
      tx,
      actorId,
      requestId,
      stock,
      "production-consume",
      {
        position,
        onHandDelta: -take,
        reservedDelta: -take,
      },
    );
    await reduceAllocation(tx, allocation, take);
    await tx.insert(inventoryProductionInputs).values({
      outputId: output.id,
      itemId: material.itemId,
      materialId: material.id,
      positionId: position.id,
      eventId,
      quantity: take,
    });
    remaining -= take;
  }
  if (remaining !== 0) failProduction("stock");
}

/** Reserve picks belong to the build. A batch consumes just its exact share in FEFO order. */
export async function consumeBatchMaterials(
  tx: Db,
  actorId: string,
  requestId: string,
  build: ProductionBuildRow,
  output: { id: string; quantity: number },
  stock: ProductionStockLocks,
  materials: ProductionMaterialRow[],
  signal: AbortSignal,
) {
  const allocations = new Map<string, Allocation[]>();
  for (const { allocation } of await readBuildAllocations(tx, build.id)) {
    const current = allocations.get(allocation.materialId) ?? [];
    current.push(allocation);
    allocations.set(allocation.materialId, current);
  }
  const context: BatchConsumption = { actorId, requestId, build, output, stock };
  for (const material of materials) {
    signal.throwIfAborted();
    if (material.consumable) continue;
    await consumeMaterial(tx, context, material, allocations.get(material.id) ?? []);
  }
}
