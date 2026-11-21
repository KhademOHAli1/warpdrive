import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { readBuildAllocations } from "../production/allocations";
import type { ProductionBuildRow } from "../production/buildSchema";
import type { SubcontractCommand } from "../production/contracts";
import { failProduction } from "../production/failure";
import { inventoryProductionAllocations } from "../production/materialSchema";
import {
  currentProductionPolicy,
  type ProductionPositionRow,
  type ProductionStockLocks,
  productionStockUnits,
  requireStorageBin,
  writeProductionStock,
} from "../production/stock";
import { lockInventoryStock } from "../stock";
import { isStockPositionEligible, readStockPositionRows } from "../warehouse/balances";
import { readEligibleBuildOrigins } from "../warehouse/productionOrigin";
import {
  inventoryStockInstallations,
  inventoryStockLocationPolicies,
  inventoryStockPositions,
} from "../warehouse/schema";
import {
  readSubcontractMaterialDemand,
  remainingCustody,
  sameStockIdentity,
  stockIdentity,
} from "./custodyBalance";
import {
  inventorySubcontractDispatches,
  inventorySubcontractReturns,
  type Subcontract,
} from "./schema";

type Dispatch = Extract<SubcontractCommand, { type: "dispatchSubcontract" }>;
type Return = Extract<SubcontractCommand, { type: "returnSubcontractMaterial" }>;
type AllocationRow = Awaited<ReturnType<typeof readBuildAllocations>>[number];
type VendorDispatch = typeof inventorySubcontractDispatches.$inferSelect;

export async function requireSupplierBin(
  tx: Db,
  { supplierBinId, siteId }: Pick<Subcontract, "supplierBinId" | "siteId">,
) {
  const [bin] = await tx
    .select({ id: directoryLocations.id })
    .from(directoryLocations)
    .innerJoin(directorySites, eq(directoryLocations.siteId, directorySites.id))
    .innerJoin(
      inventoryStockLocationPolicies,
      and(
        eq(inventoryStockLocationPolicies.siteId, directoryLocations.siteId),
        eq(inventoryStockLocationPolicies.locationId, directoryLocations.id),
      ),
    )
    .where(
      and(
        eq(directorySites.id, siteId),
        eq(directorySites.archived, false),
        eq(directoryLocations.id, supplierBinId),
        eq(directoryLocations.archived, false),
        eq(inventoryStockLocationPolicies.kind, "external"),
      ),
    );
  if (bin === undefined) failProduction("state");
}

function allocationKey({ materialId, positionId }: { materialId: string; positionId: string }) {
  return `${materialId}:${positionId}`;
}

async function selectedAllocations(tx: Db, buildId: string, command: Dispatch) {
  const indexes = new Map(
    (await readBuildAllocations(tx, buildId)).map((row) => [allocationKey(row.allocation), row]),
  );
  const seen = new Set<string>();
  return command.allocations.map((selection) => {
    const key = allocationKey(selection);
    const row = indexes.get(key);
    if (row === undefined) failProduction("unavailable");
    if (seen.has(key) || row.material.consumable || selection.quantity > row.allocation.quantity)
      failProduction("stock");
    seen.add(key);
    return { row, quantity: selection.quantity };
  });
}

async function verifySource(
  tx: Db,
  build: ProductionBuildRow,
  { material }: AllocationRow,
  position: ProductionPositionRow,
  quantity: number,
) {
  const [physical] = await readStockPositionRows(
    tx,
    [position.itemId],
    [build.siteId],
    [position.id],
  );
  if (physical === undefined || !isStockPositionEligible(physical) || physical.reserved < quantity)
    failProduction("stock");
  const policy = await currentProductionPolicy(tx, material.itemId);
  const unit = (await productionStockUnits(tx, [material.itemId])).get(material.itemId) ?? "each";
  if (unit !== material.stockUnit) failProduction("unitChanged");
  if (policy.flags.trackable && position.serial === null) failProduction("serial");
  if (position.serial !== null) {
    if (quantity !== 1 || physical.onHand !== 1 || physical.reserved !== 1) failProduction("stock");
    const [installation] = await tx
      .select({ id: inventoryStockInstallations.id })
      .from(inventoryStockInstallations)
      .where(
        and(
          eq(inventoryStockInstallations.assemblyPositionId, position.id),
          isNull(inventoryStockInstallations.removedEventId),
        ),
      )
      .limit(1);
    if (installation !== undefined) failProduction("stock");
  }
  if (material.requiredReleaseId !== null) {
    const origin = (await readEligibleBuildOrigins(tx, build.siteId, [material.itemId])).get(
      position.id,
    );
    if (origin?.releaseId !== material.requiredReleaseId || origin.stockUnit !== material.stockUnit)
      failProduction("stock");
  }
}

async function reduceDispatchedAllocation(tx: Db, { allocation }: AllocationRow, quantity: number) {
  const filter = and(
    eq(inventoryProductionAllocations.materialId, allocation.materialId),
    eq(inventoryProductionAllocations.positionId, allocation.positionId),
  );
  if (quantity === allocation.quantity) {
    await tx.delete(inventoryProductionAllocations).where(filter);
    return;
  }
  await tx
    .update(inventoryProductionAllocations)
    .set({ quantity: allocation.quantity - quantity })
    .where(filter);
}

async function relocateSerial(tx: Db, position: ProductionPositionRow, locationId: string) {
  const [relocated] = await tx
    .update(inventoryStockPositions)
    .set({ locationId })
    .where(
      and(
        eq(inventoryStockPositions.id, position.id),
        eq(inventoryStockPositions.locationId, position.locationId),
        eq(inventoryStockPositions.onHand, 0),
        eq(inventoryStockPositions.reserved, 0),
      ),
    )
    .returning();
  if (relocated === undefined) failProduction("stale");
  return relocated;
}

async function vendorParcel(tx: Db, source: ProductionPositionRow, supplierBinId: string) {
  if (source.serial !== null) return relocateSerial(tx, source, supplierBinId);
  const [parcel] = await tx
    .insert(inventoryStockPositions)
    .values({
      ...stockIdentity(source),
      siteId: source.siteId,
      locationId: supplierBinId,
      state: "available",
      onHand: 0,
      reserved: 0,
    })
    .returning();
  if (parcel === undefined) failProduction("stale");
  return parcel;
}

type DispatchContext = {
  actorId: string;
  requestId: string;
  build: ProductionBuildRow;
  subcontract: Subcontract;
  stock: ProductionStockLocks;
};

async function dispatchAllocation(
  tx: Db,
  { actorId, requestId, build, subcontract, stock }: DispatchContext,
  row: AllocationRow,
  quantity: number,
) {
  const { material, position } = row;
  if (quantity > (await readSubcontractMaterialDemand(tx, build, material)))
    failProduction("stock");
  await verifySource(tx, build, row, position, quantity);
  const sourceEventId = await writeProductionStock(
    tx,
    actorId,
    requestId,
    stock,
    "production-dispatch",
    {
      position,
      onHandDelta: -quantity,
      reservedDelta: -quantity,
    },
  );
  await reduceDispatchedAllocation(tx, row, quantity);
  const vendor = await vendorParcel(tx, position, subcontract.supplierBinId);
  const dispatchEventId = await writeProductionStock(
    tx,
    actorId,
    requestId,
    stock,
    "production-dispatch",
    {
      position: vendor,
      onHandDelta: quantity,
      reservedDelta: quantity,
      sourcePositionId: vendor.id === position.id ? undefined : position.id,
    },
  );
  await tx.insert(inventorySubcontractDispatches).values({
    buildId: build.id,
    materialId: material.id,
    itemId: material.itemId,
    sourcePositionId: position.id,
    sourceLocationId: position.locationId,
    vendorPositionId: vendor.id,
    sourceEventId,
    dispatchEventId,
    quantity,
  });
}

export async function dispatchSubcontract(
  tx: Db,
  actorId: string,
  build: ProductionBuildRow,
  subcontract: Subcontract,
  command: Dispatch,
) {
  const allocations = await selectedAllocations(tx, build.id, command);
  const stock = await lockInventoryStock(
    tx,
    allocations.map(({ row }) => row.material.itemId),
  );
  await requireSupplierBin(tx, subcontract);
  const positions = new Map<string, ProductionPositionRow>();
  const context = { actorId, requestId: command.requestId, build, subcontract, stock };
  for (const { row, quantity } of allocations) {
    const position = positions.get(row.position.id) ?? row.position;
    positions.set(position.id, position);
    await dispatchAllocation(tx, context, { ...row, position }, quantity);
  }
}

async function readDispatch(tx: Db, buildId: string, dispatchId: string) {
  const [dispatch] = await tx
    .select()
    .from(inventorySubcontractDispatches)
    .where(
      and(
        eq(inventorySubcontractDispatches.id, dispatchId),
        eq(inventorySubcontractDispatches.buildId, buildId),
      ),
    );
  if (dispatch === undefined) failProduction("unavailable");
  return dispatch;
}

export function verifyVendorPosition(
  subcontract: Subcontract,
  dispatch: VendorDispatch,
  position: ProductionPositionRow | undefined,
) {
  const count = remainingCustody(dispatch);
  if (
    position === undefined ||
    position.itemId !== dispatch.itemId ||
    position.siteId !== subcontract.siteId ||
    position.locationId !== subcontract.supplierBinId ||
    position.state !== "available" ||
    position.ownerOrganizationId !== null ||
    position.onHand !== count ||
    position.reserved !== count
  )
    failProduction("stock");
  return position;
}

export async function returnSubcontractMaterial(
  tx: Db,
  actorId: string,
  build: ProductionBuildRow,
  subcontract: Subcontract,
  command: Return,
) {
  const dispatch = await readDispatch(tx, build.id, command.dispatchId);
  const { itemId, sourceLocationId, sourcePositionId, vendorPositionId } = dispatch;
  const { quantity, requestId } = command;
  if (quantity > remainingCustody(dispatch)) failProduction("stock");
  const stock = await lockInventoryStock(tx, [itemId]);
  await requireSupplierBin(tx, subcontract);
  await requireStorageBin(tx, build.siteId, sourceLocationId);
  const positions = await readStockPositionRows(
    tx,
    [itemId],
    [build.siteId],
    [sourcePositionId, vendorPositionId],
  );
  const vendor = verifyVendorPosition(
    subcontract,
    dispatch,
    positions.find(({ id }) => id === vendorPositionId),
  );
  const original = positions.find(({ id }) => id === sourcePositionId);
  if (original === undefined || !sameStockIdentity(original, vendor)) failProduction("stock");
  if (sourcePositionId !== vendorPositionId && original.locationId !== sourceLocationId)
    failProduction("stock");
  const sourceEventId = await writeProductionStock(
    tx,
    actorId,
    requestId,
    stock,
    "production-return",
    {
      position: vendor,
      onHandDelta: -quantity,
      reservedDelta: -quantity,
    },
  );
  const source =
    sourcePositionId === vendorPositionId
      ? await relocateSerial(tx, vendor, sourceLocationId)
      : original;
  const returnEventId = await writeProductionStock(
    tx,
    actorId,
    requestId,
    stock,
    "production-return",
    {
      position: source,
      onHandDelta: quantity,
      reservedDelta: 0,
      sourcePositionId: vendor.id === source.id ? undefined : vendor.id,
    },
  );
  await tx
    .update(inventorySubcontractDispatches)
    .set({ returned: dispatch.returned + quantity })
    .where(eq(inventorySubcontractDispatches.id, dispatch.id));
  await tx
    .insert(inventorySubcontractReturns)
    .values({ dispatchId: dispatch.id, quantity, sourceEventId, returnEventId });
}
