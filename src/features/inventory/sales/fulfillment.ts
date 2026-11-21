import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { lockInventoryStock } from "../stock";
import { readStockPositionRows, stockPositionAvailable } from "../warehouse/balances";
import type { SalesCommand } from "./contracts";
import { failSales } from "./failure";
import {
  isShippablePosition,
  readSalesAllocations,
  readSalesStockCandidates,
  reduceSalesAllocation,
  reserveSalesPosition,
  type SalesAllocationRow,
  salesStockPolicy,
  writeSalesStock,
} from "./fulfillmentStock";
import {
  type SalesLineRow,
  type SalesOrderRow,
  salesAllocations,
  salesOrderLines,
  salesOrders,
  salesPackingChecks,
  salesShipmentLines,
  salesShipments,
} from "./schema";

export type SalesFulfillmentCommand = Extract<
  SalesCommand,
  {
    type:
      | "allocate"
      | "autoAllocate"
      | "deallocate"
      | "createShipment"
      | "checkShipmentLine"
      | "postShipment"
      | "cancelShipment";
  }
>;

type FulfillmentAction<T extends SalesFulfillmentCommand["type"]> = Extract<
  SalesFulfillmentCommand,
  { type: T }
>;

function findLine(lines: SalesLineRow[], id: string) {
  const line = lines.find((row) => row.id === id);
  if (line === undefined) failSales("unavailable");
  return line;
}

function allocatedByLine(allocations: SalesAllocationRow[]) {
  const totals = new Map<string, number>();
  for (const { lineId, quantity } of allocations) {
    totals.set(lineId, (totals.get(lineId) ?? 0) + quantity);
  }
  return totals;
}

function allocationRemainder(line: SalesLineRow, totals: ReadonlyMap<string, number>) {
  return line.quantity - line.shipped - (totals.get(line.id) ?? 0);
}

function currentDraft(tx: Db, orderId: string, shipmentId?: string) {
  return tx
    .select({ id: salesShipments.id })
    .from(salesShipments)
    .where(
      and(
        eq(salesShipments.orderId, orderId),
        eq(salesShipments.status, "draft"),
        shipmentId === undefined ? undefined : eq(salesShipments.id, shipmentId),
      ),
    )
    .limit(1);
}

async function requireDraft(tx: Db, orderId: string, shipmentId: string) {
  const [draft] = await currentDraft(tx, orderId, shipmentId);
  if (draft === undefined) failSales("state");
  return draft;
}

async function allocatePosition(
  tx: Db,
  actorId: string,
  order: SalesOrderRow,
  lines: SalesLineRow[],
  command: FulfillmentAction<"allocate">,
) {
  const line = findLine(lines, command.lineId);
  const stock = await lockInventoryStock(tx, [line.itemId]);
  const allocations = await readSalesAllocations(tx, order.id);
  if (command.quantity > allocationRemainder(line, allocatedByLine(allocations)))
    failSales("stock");

  const [position] = await readStockPositionRows(
    tx,
    [line.itemId],
    [order.siteId],
    [command.positionId],
  );
  if (position === undefined) failSales("unavailable");
  const policy = await salesStockPolicy(tx, line);
  if (policy === null || !isShippablePosition(position, policy.flags.trackable)) failSales("stock");
  await reserveSalesPosition(
    tx,
    actorId,
    command.requestId,
    stock,
    line,
    position,
    command.quantity,
  );
}

async function autoAllocatePositions(
  tx: Db,
  actorId: string,
  siteId: string,
  lines: SalesLineRow[],
  command: FulfillmentAction<"autoAllocate">,
  signal: AbortSignal,
) {
  const selected = command.lineId === undefined ? lines : [findLine(lines, command.lineId)];
  const stock = await lockInventoryStock(
    tx,
    selected.map(({ itemId }) => itemId),
  );
  const allocated = allocatedByLine(await readSalesAllocations(tx, command.orderId));
  for (const line of selected) {
    signal.throwIfAborted();
    let remaining = allocationRemainder(line, allocated);
    if (remaining <= 0) continue;
    for (const position of await readSalesStockCandidates(tx, siteId, line)) {
      signal.throwIfAborted();
      const quantity = Math.min(remaining, stockPositionAvailable(position));
      if (quantity === 0) continue;
      await reserveSalesPosition(tx, actorId, command.requestId, stock, line, position, quantity);
      remaining -= quantity;
      if (remaining === 0) break;
    }
  }
}

async function deallocatePosition(
  tx: Db,
  actorId: string,
  order: SalesOrderRow,
  command: FulfillmentAction<"deallocate">,
) {
  const [allocation] = await tx
    .select()
    .from(salesAllocations)
    .where(
      and(eq(salesAllocations.orderId, order.id), eq(salesAllocations.id, command.allocationId)),
    );
  if (allocation === undefined) failSales("unavailable");
  const stock = await lockInventoryStock(tx, [allocation.itemId]);
  const [draft] = await currentDraft(tx, order.id);
  const [packed] =
    draft === undefined
      ? []
      : await tx
          .select({ quantity: salesShipmentLines.quantity })
          .from(salesShipmentLines)
          .where(
            and(
              eq(salesShipmentLines.shipmentId, draft.id),
              eq(salesShipmentLines.allocationId, allocation.id),
            ),
          );
  if (command.quantity > allocation.quantity - (packed?.quantity ?? 0)) failSales("state");

  const [position] = await readStockPositionRows(
    tx,
    [allocation.itemId],
    [order.siteId],
    [allocation.positionId],
  );
  if (position === undefined) failSales("unavailable");
  await writeSalesStock(
    tx,
    actorId,
    command.requestId,
    stock,
    allocation,
    position,
    "sales-release",
    command.quantity,
  );
  await reduceSalesAllocation(tx, allocation, command.quantity);
}

function allocationMap(allocations: SalesAllocationRow[]) {
  return new Map(allocations.map((allocation) => [allocation.id, allocation]));
}

async function shipmentPositions(tx: Db, siteId: string, allocations: SalesAllocationRow[]) {
  const rows = await readStockPositionRows(
    tx,
    undefined,
    [siteId],
    allocations.map(({ positionId }) => positionId),
  );
  return new Map(rows.map((position) => [position.id, position]));
}

async function createShipmentDraft(
  tx: Db,
  actorId: string,
  order: SalesOrderRow,
  lines: SalesLineRow[],
  command: FulfillmentAction<"createShipment">,
  signal: AbortSignal,
) {
  const [previousDraft] = await currentDraft(tx, order.id);
  if (previousDraft !== undefined) failSales("state");
  const allocations = allocationMap(await readSalesAllocations(tx, order.id));
  const selected = command.lines.map(({ allocationId, quantity }) => {
    const allocation = allocations.get(allocationId);
    if (allocation === undefined) failSales("unavailable");
    if (quantity > allocation.quantity) failSales("stock");
    return { allocation, quantity };
  });
  if (
    selected.length === 0 ||
    new Set(selected.map(({ allocation }) => allocation.id)).size !== selected.length
  )
    failSales("invalid");

  await lockInventoryStock(
    tx,
    selected.map(({ allocation }) => allocation.itemId),
  );
  const positions = await shipmentPositions(
    tx,
    order.siteId,
    selected.map(({ allocation }) => allocation),
  );
  const packingRows = [];
  const policies = new Map<string, boolean>();
  for (const { allocation, quantity } of selected) {
    signal.throwIfAborted();
    const position = positions.get(allocation.positionId);
    if (position === undefined) failSales("unavailable");
    if (!policies.has(allocation.lineId)) {
      const policy = await salesStockPolicy(tx, findLine(lines, allocation.lineId));
      if (policy === null) failSales("stock");
      policies.set(allocation.lineId, policy.flags.trackable);
    }
    if (
      position.reserved < quantity ||
      !isShippablePosition(position, policies.get(allocation.lineId) === true)
    )
      failSales("stock");
    packingRows.push({
      orderId: order.id,
      shipmentId: command.requestId,
      lineId: allocation.lineId,
      itemId: allocation.itemId,
      positionId: position.id,
      allocationId: allocation.id,
      quantity,
      lot: position.lot,
      serial: position.serial,
      locationId: position.locationId,
      buildOutputId: position.buildOutputId,
    });
  }

  await tx.insert(salesShipments).values({
    id: command.requestId,
    orderId: order.id,
    reference: command.reference,
    createdBy: actorId,
  });
  await tx.insert(salesShipmentLines).values(packingRows);
  return { shipmentId: command.requestId };
}

async function checkShipmentLine(
  tx: Db,
  actorId: string,
  order: SalesOrderRow,
  lines: SalesLineRow[],
  command: FulfillmentAction<"checkShipmentLine">,
) {
  const { shipmentId, shipmentLineId, checked, scan } = command;
  await requireDraft(tx, order.id, shipmentId);
  const [packed] = await tx
    .select()
    .from(salesShipmentLines)
    .where(
      and(eq(salesShipmentLines.id, shipmentLineId), eq(salesShipmentLines.shipmentId, shipmentId)),
    );
  if (packed === undefined) failSales("unavailable");
  const scanned = checked ? (scan?.trim() ?? null) : null;
  if (
    scanned !== null &&
    scanned !== (packed.serial ?? packed.lot ?? findLine(lines, packed.lineId).partCode)
  )
    failSales("invalid");
  await tx
    .update(salesShipmentLines)
    .set({ checked })
    .where(eq(salesShipmentLines.id, shipmentLineId));
  await tx.insert(salesPackingChecks).values({
    id: command.requestId,
    orderId: order.id,
    shipmentId,
    shipmentLineId,
    actorId,
    checked,
    scan: scanned,
  });
  return { shipmentId };
}

async function postShipment(
  tx: Db,
  actorId: string,
  order: SalesOrderRow,
  lines: SalesLineRow[],
  command: FulfillmentAction<"postShipment">,
  signal: AbortSignal,
) {
  const { shipmentId } = command;
  if (command.shippedOn > new Date().toISOString().slice(0, 10)) failSales("invalid");
  await requireDraft(tx, order.id, shipmentId);
  const packed = await tx
    .select()
    .from(salesShipmentLines)
    .where(eq(salesShipmentLines.shipmentId, shipmentId))
    .orderBy(asc(salesShipmentLines.id));
  if (packed.length === 0 || !packed.every(({ checked, eventId }) => checked && eventId === null))
    failSales("state");

  const stock = await lockInventoryStock(
    tx,
    packed.map(({ itemId }) => itemId),
  );
  const allAllocations = allocationMap(await readSalesAllocations(tx, order.id));
  const selected = packed.map((entry) => {
    const allocation =
      entry.allocationId === null ? undefined : allAllocations.get(entry.allocationId);
    if (
      allocation === undefined ||
      allocation.itemId !== entry.itemId ||
      allocation.lineId !== entry.lineId ||
      allocation.positionId !== entry.positionId ||
      allocation.quantity < entry.quantity
    )
      failSales("stock");
    return { entry, allocation };
  });
  const positions = await shipmentPositions(
    tx,
    order.siteId,
    selected.map(({ allocation }) => allocation),
  );
  const shippedByLine = new Map<string, number>();
  const policies = new Map<string, boolean>();
  for (const { entry, allocation } of selected) {
    signal.throwIfAborted();
    const sale = findLine(lines, allocation.lineId);
    const shipped = (shippedByLine.get(sale.id) ?? sale.shipped) + entry.quantity;
    if (shipped > sale.quantity) failSales("stock");
    if (!policies.has(sale.id)) {
      const policy = await salesStockPolicy(tx, sale);
      if (policy === null) failSales("stock");
      policies.set(sale.id, policy.flags.trackable);
    }
    const position = positions.get(entry.positionId);
    if (
      position === undefined ||
      !isShippablePosition(position, policies.get(sale.id) === true) ||
      position.lot !== entry.lot ||
      position.serial !== entry.serial ||
      position.locationId !== entry.locationId ||
      position.buildOutputId !== entry.buildOutputId ||
      position.reserved < entry.quantity
    )
      failSales("stock");

    const eventId = await writeSalesStock(
      tx,
      actorId,
      command.requestId,
      stock,
      allocation,
      position,
      "sales-shipment",
      entry.quantity,
    );
    await tx.update(salesShipmentLines).set({ eventId }).where(eq(salesShipmentLines.id, entry.id));
    await reduceSalesAllocation(tx, allocation, entry.quantity);
    shippedByLine.set(sale.id, shipped);
  }
  for (const [lineId, shipped] of shippedByLine) {
    await tx.update(salesOrderLines).set({ shipped }).where(eq(salesOrderLines.id, lineId));
  }
  await tx
    .update(salesShipments)
    .set({
      status: "shipped",
      carrier: command.carrier,
      tracking: command.tracking,
      shippedOn: command.shippedOn,
      postedAt: sql`clock_timestamp()`,
      postedBy: actorId,
    })
    .where(eq(salesShipments.id, shipmentId));
  if (lines.every((line) => (shippedByLine.get(line.id) ?? line.shipped) === line.quantity)) {
    await tx.update(salesOrders).set({ status: "shipped" }).where(eq(salesOrders.id, order.id));
  }
  return { shipmentId };
}

export async function releaseAllSalesAllocations(
  tx: Db,
  actorId: string,
  order: SalesOrderRow,
  lines: SalesLineRow[],
  requestId: string,
) {
  const allocations = await readSalesAllocations(tx, order.id);
  const stock = await lockInventoryStock(
    tx,
    lines.map(({ itemId }) => itemId),
  );
  const positions = await shipmentPositions(tx, order.siteId, allocations);
  await tx
    .update(salesShipments)
    .set({ status: "cancelled" })
    .where(and(eq(salesShipments.orderId, order.id), eq(salesShipments.status, "draft")));
  for (const allocation of allocations) {
    const position = positions.get(allocation.positionId);
    if (position === undefined) failSales("unavailable");
    await writeSalesStock(
      tx,
      actorId,
      requestId,
      stock,
      allocation,
      position,
      "sales-release",
      allocation.quantity,
    );
  }
  await tx.delete(salesAllocations).where(eq(salesAllocations.orderId, order.id));
}

/** Authority, order locking, version checks and command replay live in the sales service. */
export async function applySalesFulfillment(
  tx: Db,
  actorId: string,
  order: SalesOrderRow,
  lines: SalesLineRow[],
  command: SalesFulfillmentCommand,
  signal: AbortSignal,
): Promise<{ shipmentId: string } | undefined> {
  signal.throwIfAborted();
  if (order.status !== "issued") failSales("state");
  switch (command.type) {
    case "allocate":
      await allocatePosition(tx, actorId, order, lines, command);
      return undefined;
    case "autoAllocate":
      await autoAllocatePositions(tx, actorId, order.siteId, lines, command, signal);
      return undefined;
    case "deallocate":
      await deallocatePosition(tx, actorId, order, command);
      return undefined;
    case "createShipment":
      return createShipmentDraft(tx, actorId, order, lines, command, signal);
    case "checkShipmentLine":
      return checkShipmentLine(tx, actorId, order, lines, command);
    case "postShipment":
      return postShipment(tx, actorId, order, lines, command, signal);
    case "cancelShipment":
      await requireDraft(tx, order.id, command.shipmentId);
      await tx
        .update(salesShipments)
        .set({ status: "cancelled" })
        .where(eq(salesShipments.id, command.shipmentId));
      return { shipmentId: command.shipmentId };
  }
}
