import { and, eq, gt, gte, isNull, ne, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { salesOrderLines, salesShipmentLines, salesShipments } from "../sales/schema";
import type { Endpoint, Position } from "../warehouse/operations/shared";
import {
  inventoryStockEventDetails,
  inventoryStockEvents,
  inventoryStockLocationPolicies,
  inventoryStockPositions,
} from "../warehouse/schema";
import { failReturn } from "./failure";

/** The caller has already authorized this site and holds the directory lock. */
export async function receivingEndpoint(tx: Db, siteId: string, locationId: string) {
  const [found] = await tx
    .select({
      siteArchived: directorySites.archived,
      locationArchived: directoryLocations.archived,
      kind: inventoryStockLocationPolicies.kind,
    })
    .from(directoryLocations)
    .innerJoin(directorySites, eq(directorySites.id, directoryLocations.siteId))
    .leftJoin(
      inventoryStockLocationPolicies,
      and(
        eq(inventoryStockLocationPolicies.siteId, siteId),
        eq(inventoryStockLocationPolicies.locationId, locationId),
      ),
    )
    .where(and(eq(directoryLocations.id, locationId), eq(directoryLocations.siteId, siteId)));
  if (
    found === undefined ||
    found.siteArchived ||
    found.locationArchived ||
    (found.kind !== null && found.kind !== "storage")
  )
    failReturn("unavailable");
  return { siteId, locationId };
}

export async function postedStockSource(tx: Db, shipmentId: string, shipmentLineId: string) {
  const [source] = await tx
    .select({
      line: salesShipmentLines,
      event: {
        id: inventoryStockEvents.id,
        positionId: inventoryStockEvents.positionId,
        itemId: inventoryStockEvents.itemId,
        onHandDelta: inventoryStockEvents.onHandDelta,
        reservedDelta: inventoryStockEvents.reservedDelta,
        kind: inventoryStockEvents.kind,
        createdAt: inventoryStockEvents.createdAt,
      },
      sequence: inventoryStockEventDetails.sequence,
      siteId: inventoryStockEventDetails.siteId,
      locationId: inventoryStockEventDetails.locationId,
      unit: salesOrderLines.stockUnit,
    })
    .from(salesShipmentLines)
    .innerJoin(salesShipments, eq(salesShipments.id, salesShipmentLines.shipmentId))
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, salesShipmentLines.lineId))
    .innerJoin(inventoryStockEvents, eq(inventoryStockEvents.id, salesShipmentLines.eventId))
    .innerJoin(
      inventoryStockEventDetails,
      eq(inventoryStockEventDetails.eventId, inventoryStockEvents.id),
    )
    .where(
      and(
        eq(salesShipmentLines.id, shipmentLineId),
        eq(salesShipmentLines.shipmentId, shipmentId),
        eq(salesShipments.status, "shipped"),
        eq(salesShipmentLines.checked, true),
      ),
    );
  if (source === undefined) failReturn("unavailable");
  const { line, event } = source;
  if (
    event.kind !== "sales-shipment" ||
    event.itemId !== line.itemId ||
    event.positionId !== line.positionId ||
    event.onHandDelta !== -line.quantity ||
    event.reservedDelta !== -line.quantity ||
    source.locationId !== line.locationId ||
    source.siteId === null
  )
    failReturn("stock");
  return source;
}

export async function custodyPosition(tx: Db, id: string) {
  const [position] = await tx
    .select()
    .from(inventoryStockPositions)
    .where(eq(inventoryStockPositions.id, id));
  if (position === undefined) failReturn("stale");
  return position;
}

export async function updateCustodyPosition(
  tx: Db,
  position: Position,
  next: Pick<Position, "state" | "onHand"> & Partial<Endpoint>,
) {
  const [updated] = await tx
    .update(inventoryStockPositions)
    .set(next)
    .where(
      and(
        eq(inventoryStockPositions.id, position.id),
        eq(inventoryStockPositions.siteId, position.siteId),
        eq(inventoryStockPositions.locationId, position.locationId),
        eq(inventoryStockPositions.onHand, position.onHand),
        eq(inventoryStockPositions.reserved, position.reserved),
        eq(inventoryStockPositions.state, position.state),
      ),
    )
    .returning({ id: inventoryStockPositions.id });
  if (updated === undefined) failReturn("stale");
  return updated.id;
}

async function verifyShippedSerial(
  tx: Db,
  position: Position,
  source: Awaited<ReturnType<typeof postedStockSource>>,
) {
  if (
    position.onHand !== 0 ||
    position.reserved !== 0 ||
    position.siteId !== source.siteId ||
    position.locationId !== source.locationId ||
    position.state !== "available"
  )
    failReturn("stock");
  // Any newer position event defeats the source shipment's claim to the empty serial.
  // For unsequenced history, only an earlier timestamp rules out a later custody effect.
  const event = inventoryStockEvents;
  const details = inventoryStockEventDetails;
  const [later] = await tx
    .select({ id: event.id })
    .from(event)
    .leftJoin(details, eq(details.eventId, event.id))
    .where(
      and(
        or(eq(event.positionId, position.id), eq(event.sourcePositionId, position.id)),
        ne(event.id, source.event.id),
        or(
          gt(details.sequence, source.sequence),
          and(isNull(details.eventId), gte(event.createdAt, source.event.createdAt)),
        ),
      ),
    )
    .limit(1);
  if (later !== undefined) failReturn("stock");
}

/** An item stock lock must cover the source position throughout receipt. */
export async function creditQuarantine(
  tx: Db,
  source: Awaited<ReturnType<typeof postedStockSource>>,
  target: Endpoint,
  quantity: number,
) {
  const { line } = source;
  const position = await custodyPosition(tx, line.positionId);
  if (
    position.itemId !== line.itemId ||
    position.lot !== line.lot ||
    position.serial !== line.serial ||
    position.buildOutputId !== line.buildOutputId ||
    position.ownerOrganizationId !== null
  )
    failReturn("stock");
  if (line.serial !== null) {
    await verifyShippedSerial(tx, position, source);
    return updateCustodyPosition(tx, position, { ...target, onHand: 1, state: "quarantine" });
  }
  // The original lot may still be selling. Keep each receipt under its own custody record.
  const [created] = await tx
    .insert(inventoryStockPositions)
    .values({
      ...target,
      itemId: line.itemId,
      lot: position.lot,
      expiryDate: position.expiryDate,
      buildOutputId: position.buildOutputId,
      state: "quarantine",
      onHand: quantity,
    })
    .returning({ id: inventoryStockPositions.id });
  if (created === undefined) failReturn("conflict");
  return created.id;
}
