import { and, asc, desc, eq, inArray, isNotNull, notExists, or, sql, sum } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals, pipelines } from "@/db/schema";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { inventoryDealVisibility, readInventoryDeal } from "../access";
import { lockInventoryCatalog } from "../catalog/policy";
import { inventoryPartProfiles } from "../catalog/schema";
import { readWarehouseAccess, type WarehouseAccess } from "../warehouse/access";
import { stockPositionAvailable } from "../warehouse/balances";
import { inventoryStockPositions } from "../warehouse/schema";
import type {
  SalesOrderDetail,
  SalesOrderLine,
  SalesOrderSummary,
  SalesQuery,
  SalesShipment,
  SalesWorkspaceResult,
} from "./contracts";
import { failSales, SalesFailure } from "./failure";
import { readSalesStockCandidates } from "./fulfillmentStock";
import { isInactiveSalesDeal, readSalesOrderLines } from "./orders";
import {
  salesAllocations,
  salesOrderLines,
  salesOrders,
  salesShipmentLines,
  salesShipments,
} from "./schema";
import {
  readSalesDeal,
  readSalesPartAccess,
  readSalesSites,
  readSellableParts,
  requireSalesActor,
} from "./scope";

function readSalesOrders(tx: Db, actor: HydratedActor, siteIds: string[], dealId?: string) {
  const visibleDeal = sql<boolean>`COALESCE(${inventoryDealVisibility(actor)}, false)`;
  const ordered = tx
    .select({
      orderId: salesOrderLines.orderId,
      ordered: sum(salesOrderLines.quantity).mapWith(Number).as("ordered_units"),
      shipped: sum(salesOrderLines.shipped).mapWith(Number).as("shipped_units"),
    })
    .from(salesOrderLines)
    .groupBy(salesOrderLines.orderId)
    .as("sales_order_totals");
  const reserved = tx
    .select({
      orderId: salesAllocations.orderId,
      allocated: sum(salesAllocations.quantity).mapWith(Number).as("allocated_units"),
    })
    .from(salesAllocations)
    .groupBy(salesAllocations.orderId)
    .as("sales_reservation_totals");
  const restrictedPart = tx
    .select({ itemId: salesOrderLines.itemId })
    .from(salesOrderLines)
    .innerJoin(inventoryPartProfiles, eq(inventoryPartProfiles.itemId, salesOrderLines.itemId))
    .where(
      and(
        eq(salesOrderLines.orderId, salesOrders.id),
        eq(inventoryPartProfiles.visibility, "admin"),
      ),
    );

  return tx
    .select({
      order: salesOrders,
      visibleDeal,
      ordered: sql<number>`COALESCE(${ordered.ordered}, 0)`.mapWith(Number),
      shipped: sql<number>`COALESCE(${ordered.shipped}, 0)`.mapWith(Number),
      allocated: sql<number>`COALESCE(${reserved.allocated}, 0)`.mapWith(Number),
    })
    .from(salesOrders)
    .leftJoin(deals, eq(deals.id, salesOrders.dealId))
    .leftJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .leftJoin(ordered, eq(ordered.orderId, salesOrders.id))
    .leftJoin(reserved, eq(reserved.orderId, salesOrders.id))
    .where(
      and(
        or(visibleDeal, and(isNotNull(salesOrders.issuedAt), inArray(salesOrders.siteId, siteIds))),
        actor.type === "admin" ? undefined : notExists(restrictedPart),
        dealId === undefined ? undefined : eq(salesOrders.dealId, dealId),
      ),
    )
    .orderBy(desc(salesOrders.createdAt), asc(salesOrders.id));
}

type OrderProjection = Awaited<ReturnType<typeof readSalesOrders>>[number];

function orderSummary(row: OrderProjection): SalesOrderSummary {
  const { order, visibleDeal, ordered, shipped, allocated } = row;
  return {
    id: order.id,
    siteId: order.siteId,
    dealId: visibleDeal ? order.dealId : null,
    reference: order.reference,
    status: order.status,
    dueDate: order.dueDate,
    createdAt: order.createdAt.toISOString(),
    ordered,
    allocated,
    shipped,
    backordered: order.status === "issued" ? Math.max(0, ordered - shipped - allocated) : 0,
    customerName: visibleDeal ? order.customerName : null,
  };
}

async function readSalesShipments(tx: Db, orderId: string) {
  const shipments = await tx
    .select({
      id: salesShipments.id,
      status: salesShipments.status,
      reference: salesShipments.reference,
      carrier: salesShipments.carrier,
      tracking: salesShipments.tracking,
      shippedOn: salesShipments.shippedOn,
    })
    .from(salesShipments)
    .where(eq(salesShipments.orderId, orderId))
    .orderBy(desc(salesShipments.createdAt), asc(salesShipments.id));
  const lines = await tx
    .select({ line: salesShipmentLines })
    .from(salesShipmentLines)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, salesShipmentLines.lineId))
    .where(eq(salesShipmentLines.orderId, orderId))
    .orderBy(asc(salesOrderLines.ordinal), asc(salesShipmentLines.id));
  const byShipment = new Map<string, (typeof lines)[number]["line"][]>();
  for (const { line } of lines) {
    const group = byShipment.get(line.shipmentId) ?? [];
    group.push(line);
    byShipment.set(line.shipmentId, group);
  }
  return shipments.map((shipment) => ({ ...shipment, lines: byShipment.get(shipment.id) ?? [] }));
}

type OrderShipments = Awaited<ReturnType<typeof readSalesShipments>>;

function shipmentView(
  shipments: OrderShipments,
  locations: Map<string, string> | null,
): SalesShipment[] {
  return shipments.map(({ lines, ...shipment }) => ({
    ...shipment,
    lines: lines.map(({ id, lineId, quantity, checked, lot, serial, eventId, locationId }) => {
      const location = locations?.get(locationId);
      return {
        id,
        lineId,
        quantity,
        checked,
        lot: location === undefined ? null : lot,
        serial: location === undefined ? null : serial,
        location: location ?? "",
        eventId: location === undefined ? null : eventId,
      };
    }),
  }));
}

async function readOrderAllocations(tx: Db, orderId: string) {
  return tx
    .select({
      id: salesAllocations.id,
      lineId: salesAllocations.lineId,
      positionId: salesAllocations.positionId,
      quantity: salesAllocations.quantity,
      locationId: inventoryStockPositions.locationId,
      lot: inventoryStockPositions.lot,
      serial: inventoryStockPositions.serial,
    })
    .from(salesAllocations)
    .innerJoin(inventoryStockPositions, eq(inventoryStockPositions.id, salesAllocations.positionId))
    .where(eq(salesAllocations.orderId, orderId))
    .orderBy(asc(salesAllocations.id));
}

async function orderLineViews(
  tx: Db,
  row: OrderProjection,
  shipments: OrderShipments,
  locations: Map<string, string> | null,
  signal: AbortSignal,
): Promise<SalesOrderLine[]> {
  const { order, visibleDeal } = row;
  const lines = await readSalesOrderLines(tx, order.id);
  const allocations = await readOrderAllocations(tx, order.id);
  const draft = shipments.find(({ status }) => status === "draft");
  const packed = new Map(
    draft?.lines.map(({ allocationId, quantity }) => [allocationId, quantity]),
  );
  const views = [];
  for (const line of lines) {
    signal.throwIfAborted();
    const reserved = allocations.filter(({ lineId }) => lineId === line.id);
    const available =
      locations === null || order.status !== "issued"
        ? []
        : await readSalesStockCandidates(tx, order.siteId, line);
    views.push({
      id: line.id,
      itemId: line.itemId,
      code: line.partCode,
      name: line.partName,
      revision: line.partRevision,
      unit: line.stockUnit,
      quantity: line.quantity,
      shipped: line.shipped,
      allocated: reserved.reduce((total, allocation) => total + allocation.quantity, 0),
      note: visibleDeal ? line.note : null,
      unitPrice: visibleDeal ? line.unitPrice : null,
      allocations:
        locations === null
          ? []
          : reserved
              .filter(({ locationId }) => locations.has(locationId))
              .map(({ id, positionId, quantity, lot, serial, locationId }) => ({
                id,
                positionId,
                quantity,
                lot,
                serial,
                location: locations.get(locationId) ?? "",
                committed: packed.get(id) ?? 0,
              })),
      positions: available.map((position) => ({
        id: position.id,
        lot: position.lot,
        serial: position.serial,
        location: locations?.get(position.locationId) ?? "",
        available: stockPositionAvailable(position),
      })),
    });
  }
  return views;
}

async function orderDetail(
  tx: Db,
  actor: HydratedActor,
  row: OrderProjection,
  warehouse: WarehouseAccess,
  signal: AbortSignal,
): Promise<SalesOrderDetail> {
  const { order, visibleDeal } = row;
  const site = warehouse.sites.find(({ id }) => id === order.siteId);
  const locations =
    site === undefined
      ? null
      : new Map(
          warehouse.locations
            .filter(({ siteId }) => siteId === site.id)
            .map(({ id, name }) => [id, name]),
        );
  const open = order.status === "draft" || order.status === "issued";
  const canEditDeal =
    visibleDeal &&
    order.dealId !== null &&
    (await readInventoryDeal(tx, actor, order.dealId))?.canOrder === true;
  const canEdit = open && canEditDeal;
  const canCancel =
    canEdit ||
    (order.status === "issued" &&
      site?.canManage === true &&
      (await isInactiveSalesDeal(tx, order.dealId)));
  const shipments = await readSalesShipments(tx, order.id);

  return {
    ...orderSummary(row),
    version: order.version,
    canEdit,
    canReturn: canEditDeal,
    canCancel,
    canFulfill: order.status === "issued" && site?.canManage === true && !site.archived,
    delivery:
      visibleDeal || site?.canManage === true
        ? { recipient: order.recipient, address: order.address }
        : null,
    commercial: visibleDeal
      ? { dealName: order.dealName, currency: order.currency, charges: order.charges }
      : null,
    lines: await orderLineViews(tx, row, shipments, locations, signal),
    shipments: shipmentView(shipments, locations),
  };
}

export async function readSalesWorkspace(
  db: Db,
  who: NativeSessionRef,
  query: SalesQuery,
  signal: AbortSignal,
): Promise<SalesWorkspaceResult> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      await lockDirectory(tx, "read", signal);
      const actor = await requireSalesActor(tx, who, signal);
      const deal = query.dealId === undefined ? null : await readSalesDeal(tx, actor, query.dealId);
      if (query.dealId !== undefined && deal === null) failSales("unavailable");

      const warehouse = await readWarehouseAccess(tx, actor, signal);
      const siteAccess = new Map(warehouse.sites.map((site) => [site.id, site]));
      const rows = await readSalesOrders(tx, actor, [...siteAccess.keys()], query.dealId);
      const matching =
        query.siteId === undefined
          ? rows
          : rows.filter(({ order }) => order.siteId === query.siteId);
      const current =
        query.orderId === undefined
          ? undefined
          : matching.find(({ order }) => order.id === query.orderId);
      if (query.orderId !== undefined && current === undefined) failSales("unavailable");
      const detail =
        current === undefined ? null : await orderDetail(tx, actor, current, warehouse, signal);

      const hasDraftChoices =
        deal?.canOrder === true || (detail?.status === "draft" && detail.canEdit);
      const visibleSiteIds = new Set(rows.map(({ order }) => order.siteId));
      const sites = (await readSalesSites(tx))
        .filter(
          ({ id, archived }) =>
            siteAccess.has(id) || visibleSiteIds.has(id) || (hasDraftChoices && !archived),
        )
        .map(({ id, code, name, archived }) => ({
          id,
          code,
          name,
          archived,
          canFulfill: !archived && siteAccess.get(id)?.canManage === true,
        }));
      if (query.siteId !== undefined && !sites.some(({ id }) => id === query.siteId))
        failSales("unavailable");
      const parts = hasDraftChoices
        ? await readSellableParts(tx, (await readSalesPartAccess(tx, actor)).sellable)
        : [];

      await requireSalesActor(tx, who, signal);
      return ok({
        today: new Date().toISOString().slice(0, 10),
        sites,
        deal,
        parts,
        orders: matching.map(orderSummary),
        detail,
      });
    });
  } catch (error) {
    if (error instanceof SalesFailure) return err(error.code);
    throw error;
  }
}
