import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { readBuildMaterials, releaseAllBuildAllocations } from "../production/allocations";
import {
  inventoryProductionBuilds,
  inventoryProductionOutputs,
  type ProductionBuildRow,
} from "../production/buildSchema";
import type { SubcontractCommand } from "../production/contracts";
import { failProduction } from "../production/failure";
import {
  inventoryProductionInputs,
  type inventoryProductionMaterials,
} from "../production/materialSchema";
import {
  currentProductionPolicy,
  type ProductionPositionRow,
  type ProductionStockLocks,
  productionStockUnits,
  requireStorageBin,
  writeProductionStock,
} from "../production/stock";
import { purchaseOrders, purchaseReceiptLines } from "../purchasing/schema";
import { lockInventoryStock } from "../stock";
import { earliestExpiryFirst, readStockPositionRows } from "../warehouse/balances";
import { addOperationEvent } from "../warehouse/operations/shared";
import { readEligibleBuildOrigins } from "../warehouse/productionOrigin";
import { inventoryStockEvents, inventoryStockPositions } from "../warehouse/schema";
import { requireSupplierBin, verifyVendorPosition } from "./custody";
import { outstandingSubcontractQuantity, remainingCustody } from "./custodyBalance";
import {
  inventorySubcontractConsumptions,
  inventorySubcontractDispatches,
  inventorySubcontractMaterials,
  inventorySubcontractReceipts,
  type Subcontract,
} from "./schema";

type Release = Extract<SubcontractCommand, { type: "releaseSubcontractOutput" }>;
type Material = typeof inventoryProductionMaterials.$inferSelect;
type Dispatch = typeof inventorySubcontractDispatches.$inferSelect;
type CustodyPick = { dispatch: Dispatch; position: ProductionPositionRow; quantity: number };

async function readReceivedOutput(tx: Db, subcontract: Subcontract, outputId: string) {
  const receiptLink = inventorySubcontractReceipts;
  const [row] = await tx
    .select({
      output: inventoryProductionOutputs,
      position: inventoryStockPositions,
      receipt: purchaseReceiptLines,
      orderLocationId: purchaseOrders.locationId,
    })
    .from(receiptLink)
    .innerJoin(inventoryProductionOutputs, eq(inventoryProductionOutputs.id, receiptLink.outputId))
    .innerJoin(purchaseReceiptLines, eq(purchaseReceiptLines.id, receiptLink.receiptLineId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, receiptLink.orderId))
    .innerJoin(inventoryStockPositions, eq(inventoryStockPositions.id, receiptLink.positionId))
    .innerJoin(
      inventoryStockEvents,
      and(
        eq(inventoryStockEvents.id, purchaseReceiptLines.eventId),
        eq(inventoryStockEvents.positionId, receiptLink.positionId),
        eq(inventoryStockEvents.kind, "receipt"),
        eq(inventoryStockEvents.state, "hold"),
        eq(inventoryStockEvents.onHandDelta, purchaseReceiptLines.quantity),
      ),
    )
    .where(
      and(
        eq(receiptLink.outputId, outputId),
        eq(receiptLink.buildId, subcontract.buildId),
        eq(receiptLink.orderId, subcontract.orderId),
        eq(purchaseReceiptLines.orderId, subcontract.orderId),
        eq(purchaseReceiptLines.lineId, subcontract.lineId),
        eq(purchaseReceiptLines.disposition, "accepted"),
        eq(purchaseReceiptLines.positionId, receiptLink.positionId),
      ),
    );
  if (row === undefined) failProduction("unavailable");
  return row;
}

function outputMatchesReceipt({
  output,
  receipt,
  position,
}: Awaited<ReturnType<typeof readReceivedOutput>>) {
  const serials = receipt.serial === null ? [] : [receipt.serial];
  return (
    output.lot === receipt.lot &&
    output.quantity === receipt.quantity &&
    output.serials.length === serials.length &&
    output.serials.every((serial, index) => serial === serials[index]) &&
    position.lot === receipt.lot &&
    position.serial === receipt.serial &&
    position.expiryDate === receipt.expiryDate &&
    position.buildOutputId === output.id &&
    position.state === "hold" &&
    position.ownerOrganizationId === null &&
    position.onHand === output.quantity &&
    position.reserved === 0
  );
}

async function validateReceivedOutput(
  tx: Db,
  build: ProductionBuildRow,
  row: Awaited<ReturnType<typeof readReceivedOutput>>,
) {
  const { output, position, orderLocationId } = row;
  if (
    output.buildId !== build.id ||
    output.itemId !== build.itemId ||
    output.releaseId !== build.releaseId ||
    output.status !== "wip" ||
    output.quantity > build.quantity - build.completed - build.scrapped
  )
    failProduction("state");
  if (
    position.itemId !== build.itemId ||
    position.siteId !== build.siteId ||
    position.locationId !== orderLocationId ||
    !outputMatchesReceipt(row)
  )
    failProduction("stock");
  const policy = await currentProductionPolicy(tx, build.itemId);
  const unit = (await productionStockUnits(tx, [build.itemId])).get(build.itemId) ?? "each";
  if (unit !== build.stockUnit) failProduction("unitChanged");
  if (policy.flags.trackable !== build.trackable || (build.trackable && position.serial === null))
    failProduction("serial");
  await requireStorageBin(tx, build.siteId, orderLocationId);
}

async function readCompanyStock(tx: Db, build: ProductionBuildRow, materials: Material[]) {
  const company = await tx
    .select({ id: inventorySubcontractMaterials.materialId })
    .from(inventorySubcontractMaterials)
    .where(eq(inventorySubcontractMaterials.buildId, build.id));
  const companyIds = new Set(company.map(({ id }) => id));
  const required = materials.filter(({ id }) => companyIds.has(id));
  if (required.length !== companyIds.size || required.some(({ consumable }) => consumable))
    failProduction("state");
  return required;
}

async function chooseCustody(
  tx: Db,
  subcontract: Subcontract,
  material: Material,
  quantity: number,
): Promise<CustodyPick[]> {
  const dispatches = await tx
    .select()
    .from(inventorySubcontractDispatches)
    .where(
      and(
        eq(inventorySubcontractDispatches.buildId, subcontract.buildId),
        eq(inventorySubcontractDispatches.materialId, material.id),
        gt(outstandingSubcontractQuantity, 0),
      ),
    )
    .orderBy(asc(inventorySubcontractDispatches.createdAt), asc(inventorySubcontractDispatches.id));
  const rows = await readStockPositionRows(
    tx,
    [material.itemId],
    [subcontract.siteId],
    dispatches.map(({ vendorPositionId }) => vendorPositionId),
  );
  const orderedIds = new Map(rows.sort(earliestExpiryFirst).map(({ id }, index) => [id, index]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  dispatches.sort(
    (left, right) =>
      (orderedIds.get(left.vendorPositionId) ?? -1) -
      (orderedIds.get(right.vendorPositionId) ?? -1),
  );
  const requiredOrigins =
    material.requiredReleaseId === null
      ? null
      : await readEligibleBuildOrigins(tx, subcontract.siteId, [material.itemId]);
  let remaining = quantity;
  const picks: CustodyPick[] = [];
  for (const dispatch of dispatches) {
    if (remaining === 0) break;
    const position = verifyVendorPosition(
      subcontract,
      dispatch,
      byId.get(dispatch.vendorPositionId),
    );
    if (requiredOrigins !== null) {
      const origin = requiredOrigins.get(position.id);
      if (
        origin?.releaseId !== material.requiredReleaseId ||
        origin.stockUnit !== material.stockUnit
      )
        failProduction("stock");
    }
    const take = Math.min(remaining, remainingCustody(dispatch));
    picks.push({ dispatch, position, quantity: take });
    remaining -= take;
  }
  if (remaining !== 0) failProduction("stock");
  return picks;
}

async function recordCustodyConsumption(
  tx: Db,
  actorId: string,
  stock: ProductionStockLocks,
  command: Release,
  pick: CustodyPick,
) {
  const { dispatch, position, quantity } = pick;
  const eventId = await writeProductionStock(
    tx,
    actorId,
    command.requestId,
    stock,
    "production-consume",
    {
      position,
      onHandDelta: -quantity,
      reservedDelta: -quantity,
    },
  );
  await tx.insert(inventoryProductionInputs).values({
    outputId: command.outputId,
    materialId: dispatch.materialId,
    itemId: dispatch.itemId,
    positionId: position.id,
    eventId,
    quantity,
  });
  await tx.insert(inventorySubcontractConsumptions).values({
    eventId,
    outputId: command.outputId,
    dispatchId: dispatch.id,
    quantity,
  });
  await tx
    .update(inventorySubcontractDispatches)
    .set({ consumed: dispatch.consumed + quantity })
    .where(eq(inventorySubcontractDispatches.id, dispatch.id));
}

async function releaseHeldStock(
  tx: Db,
  actorId: string,
  command: Release,
  { output, position }: Awaited<ReturnType<typeof readReceivedOutput>>,
) {
  const [updated] = await tx
    .update(inventoryProductionOutputs)
    .set({
      status: "completed",
      settledBy: actorId,
      settledAt: sql`clock_timestamp()`,
      reason: command.reason,
    })
    .where(
      and(
        eq(inventoryProductionOutputs.id, output.id),
        eq(inventoryProductionOutputs.status, "wip"),
      ),
    )
    .returning({ id: inventoryProductionOutputs.id });
  if (updated === undefined) failProduction("stale");

  const [released] = await tx
    .update(inventoryStockPositions)
    .set({ state: "available" })
    .where(
      and(
        eq(inventoryStockPositions.id, position.id),
        eq(inventoryStockPositions.buildOutputId, output.id),
        eq(inventoryStockPositions.state, "hold"),
      ),
    )
    .returning({ id: inventoryStockPositions.id });
  if (released === undefined) failProduction("stale");
  await addOperationEvent(
    tx,
    { id: actorId },
    { requestId: command.requestId, reason: "Release inspected subcontract output" },
    {
      itemId: position.itemId,
      positionId: position.id,
      kind: "production-accept",
      state: "available",
      previousState: "hold",
    },
    { siteId: position.siteId, locationId: position.locationId, previousOnHand: position.onHand },
  );
}

export async function releaseSubcontractOutput(
  tx: Db,
  actorId: string,
  build: ProductionBuildRow,
  subcontract: Subcontract,
  command: Release,
) {
  const materials = await readBuildMaterials(tx, build.id);
  const stock = await lockInventoryStock(tx, [
    build.itemId,
    ...materials.map(({ itemId }) => itemId),
  ]);
  const received = await readReceivedOutput(tx, subcontract, command.outputId);
  await validateReceivedOutput(tx, build, received);
  const companyStock = await readCompanyStock(tx, build, materials);
  if (companyStock.length > 0) await requireSupplierBin(tx, subcontract);
  const currentUnits = await productionStockUnits(
    tx,
    companyStock.map(({ itemId }) => itemId),
  );
  for (const material of companyStock) {
    if ((currentUnits.get(material.itemId) ?? "each") !== material.stockUnit)
      failProduction("unitChanged");
    const picks = await chooseCustody(
      tx,
      subcontract,
      material,
      material.perUnit * received.output.quantity,
    );
    for (const pick of picks) await recordCustodyConsumption(tx, actorId, stock, command, pick);
  }

  // The PO receipt already credited stock. Only make its existing position available.
  await releaseHeldStock(tx, actorId, command, received);
  const completed = build.completed + received.output.quantity;
  const closed = completed + build.scrapped === build.quantity;
  await tx
    .update(inventoryProductionBuilds)
    .set({ completed, status: closed ? "closed" : build.status })
    .where(eq(inventoryProductionBuilds.id, build.id));
  if (closed) await releaseAllBuildAllocations(tx, actorId, command.requestId, build, stock);
}
