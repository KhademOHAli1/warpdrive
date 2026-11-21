import { and, asc, desc, eq, inArray, isNotNull, notExists, or, sql, sum } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals, pipelines } from "@/db/schema";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directorySites } from "@/features/locations/schema";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { currentInventoryActor, inventoryDealVisibility, readInventoryDeal } from "../access";
import { lockInventoryCatalog } from "../catalog/policy";
import { inventoryPartProfiles } from "../catalog/schema";
import { isInactiveSalesDeal } from "../sales/orders";
import { salesOrderLines, salesOrders, salesShipmentLines, salesShipments } from "../sales/schema";
import { readSalesSites } from "../sales/scope";
import { readWarehouseAccess, type WarehouseAccess } from "../warehouse/access";
import { unresolvedReturn } from "./cases";
import type {
  ReturnDetail,
  ReturnLineView,
  ReturnSource,
  ReturnSummary,
  ReturnsQuery,
  ReturnsWorkspaceResult,
} from "./contracts";
import { failReturn, ReturnFailure } from "./failure";
import {
  returnCases,
  returnCommercial,
  returnHistory,
  returnLines,
  returnReceipts,
} from "./schema";
import { readCaseReceipts, readReturnSourceLines } from "./source";

function visibleDealFor(actor: HydratedActor) {
  return sql<boolean>`COALESCE(${inventoryDealVisibility(actor)}, false)`;
}

function unrestrictedOrder(tx: Db, actor: HydratedActor) {
  if (actor.type === "admin") return undefined;
  return notExists(
    tx
      .select({ itemId: salesOrderLines.itemId })
      .from(salesOrderLines)
      .innerJoin(inventoryPartProfiles, eq(inventoryPartProfiles.itemId, salesOrderLines.itemId))
      .where(
        and(
          eq(salesOrderLines.orderId, salesOrders.id),
          eq(inventoryPartProfiles.visibility, "admin"),
        ),
      ),
  );
}

function visibleCases(tx: Db, actor: HydratedActor, siteIds: string[], shipmentId?: string) {
  const visibleDeal = visibleDealFor(actor);
  const ordered = tx
    .select({
      caseId: returnLines.caseId,
      quantity: sum(returnLines.quantity).as("ordered_quantity"),
    })
    .from(returnLines)
    .groupBy(returnLines.caseId)
    .as("return_ordered");
  const received = tx
    .select({
      caseId: returnReceipts.caseId,
      quantity: sum(returnReceipts.quantity).as("received_quantity"),
    })
    .from(returnReceipts)
    .groupBy(returnReceipts.caseId)
    .as("return_received");
  return tx
    .select({
      record: returnCases,
      shipmentReference: salesShipments.reference,
      dealId: salesOrders.dealId,
      currency: salesOrders.currency,
      archivedSite: directorySites.archived,
      visibleDeal,
      quantity: sql<number>`COALESCE(${ordered.quantity}, 0)`.mapWith(Number),
      received: sql<number>`COALESCE(${received.quantity}, 0)`.mapWith(Number),
    })
    .from(returnCases)
    .innerJoin(salesShipments, eq(salesShipments.id, returnCases.shipmentId))
    .innerJoin(salesOrders, eq(salesOrders.id, returnCases.orderId))
    .innerJoin(directorySites, eq(directorySites.id, returnCases.siteId))
    .leftJoin(deals, eq(deals.id, salesOrders.dealId))
    .leftJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .leftJoin(ordered, eq(ordered.caseId, returnCases.id))
    .leftJoin(received, eq(received.caseId, returnCases.id))
    .where(
      and(
        or(visibleDeal, and(isNotNull(returnCases.issuedAt), inArray(returnCases.siteId, siteIds))),
        unrestrictedOrder(tx, actor),
        shipmentId === undefined ? undefined : eq(returnCases.shipmentId, shipmentId),
      ),
    )
    .orderBy(desc(returnCases.createdAt), asc(returnCases.id));
}

type VisibleCase = Awaited<ReturnType<typeof visibleCases>>[number];

function caseSummary({
  record,
  shipmentReference,
  quantity,
  received,
}: VisibleCase): ReturnSummary {
  const { id, shipmentId, siteId, reference, status, createdAt } = record;
  return {
    id,
    shipmentId,
    shipmentReference,
    siteId,
    reference,
    status,
    quantity,
    received,
    createdAt: createdAt.toISOString(),
  };
}

function returnDetailLines(tx: Db, caseId: string) {
  return tx
    .select({
      id: returnLines.id,
      shipmentLineId: returnLines.shipmentLineId,
      quantity: returnLines.quantity,
      reason: returnLines.reason,
      code: salesOrderLines.partCode,
      name: salesOrderLines.partName,
      revision: salesOrderLines.partRevision,
      lot: salesShipmentLines.lot,
      serial: salesShipmentLines.serial,
    })
    .from(returnLines)
    .innerJoin(salesShipmentLines, eq(salesShipmentLines.id, returnLines.shipmentLineId))
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, salesShipmentLines.lineId))
    .where(eq(returnLines.caseId, caseId))
    .orderBy(asc(salesOrderLines.ordinal), asc(returnLines.id));
}

async function readCommercialReceipts(tx: Db, caseId: string) {
  const decisions = await tx
    .select({
      receiptId: returnCommercial.receiptId,
      kind: returnCommercial.kind,
      amount: returnCommercial.amount,
      reference: returnCommercial.reference,
      reason: returnCommercial.reason,
    })
    .from(returnCommercial)
    .innerJoin(returnReceipts, eq(returnReceipts.id, returnCommercial.receiptId))
    .where(eq(returnReceipts.caseId, caseId));
  return new Map(decisions.map(({ receiptId, ...decision }) => [receiptId, decision]));
}

type CaseReceipts = Awaited<ReturnType<typeof readCaseReceipts>>;

async function projectCaseLines(
  tx: Db,
  scope: VisibleCase,
  receipts: CaseReceipts,
  warehouse: WarehouseAccess,
): Promise<ReturnLineView[]> {
  const caseId = scope.record.id;
  const lines = await returnDetailLines(tx, caseId);
  const commercial = scope.visibleDeal ? await readCommercialReceipts(tx, caseId) : null;
  const locations = new Map(
    warehouse.locations
      .filter(({ siteId }) => siteId === scope.record.siteId)
      .map(({ id, name }) => [id, name]),
  );
  const byLine = new Map<string, ReturnLineView["receipts"]>();
  for (const receipt of receipts) {
    const location = locations.get(receipt.locationId);
    const entries = byLine.get(receipt.lineId) ?? [];
    entries.push({
      id: receipt.id,
      positionId: location === undefined ? "" : receipt.positionId,
      location: location ?? "",
      quantity: receipt.quantity,
      condition: receipt.condition,
      note: receipt.note,
      receivedAt: receipt.createdAt.toISOString(),
      eventId: location === undefined ? "" : receipt.eventId,
      physical: receipt.physical,
      commercial: commercial?.get(receipt.id) ?? null,
    });
    byLine.set(receipt.lineId, entries);
  }
  return lines.map((line) => {
    const entries = byLine.get(line.id) ?? [];
    return {
      ...line,
      received: entries.reduce((total, entry) => total + entry.quantity, 0),
      receipts: entries,
    };
  });
}

async function returnCaseHistory(tx: Db, scope: VisibleCase): Promise<ReturnDetail["history"]> {
  const history = await tx
    .select({
      id: returnHistory.id,
      type: returnHistory.type,
      createdAt: returnHistory.createdAt,
      reason: returnHistory.reason,
    })
    .from(returnHistory)
    .where(eq(returnHistory.caseId, scope.record.id))
    .orderBy(asc(returnHistory.createdAt), asc(returnHistory.id));
  return history
    .filter(({ type }) => scope.visibleDeal || type !== "commercial")
    .map(({ id, type, createdAt, reason }) => ({ id, type, at: createdAt.toISOString(), reason }));
}

async function mayEditDeal(
  tx: Db,
  actor: HydratedActor,
  scope: { visibleDeal: boolean; dealId: string | null },
) {
  return (
    scope.visibleDeal &&
    scope.dealId !== null &&
    (await readInventoryDeal(tx, actor, scope.dealId))?.canOrder === true
  );
}

async function caseDetail(
  tx: Db,
  actor: HydratedActor,
  scope: VisibleCase,
  warehouse: WarehouseAccess,
): Promise<ReturnDetail> {
  const { record, visibleDeal, dealId, currency } = scope;
  const site = warehouse.sites.find(({ id }) => id === record.siteId);
  const manager = site?.canManage === true;
  const activeManager = manager && !site.archived;
  const canEdit = await mayEditDeal(tx, actor, scope);
  const receipts = await readCaseReceipts(tx, record.id);
  const lines = await projectCaseLines(tx, scope, receipts, warehouse);
  const issuedOrHeld = record.status === "issued" || record.status === "onHold";
  const resolved = !receipts.some(unresolvedReturn);
  const canCancel =
    resolved &&
    (record.status === "draft" || issuedOrHeld) &&
    (canEdit || (issuedOrHeld && manager && (await isInactiveSalesDeal(tx, dealId))));
  return {
    ...caseSummary(scope),
    version: record.version,
    canEdit,
    canReceive: record.status === "issued" && activeManager,
    canDispose: issuedOrHeld && activeManager,
    canCommercial:
      canEdit &&
      lines.some(({ receipts }) => receipts.some(({ commercial }) => commercial === null)),
    canDuplicate: canEdit && !scope.archivedSite,
    canCancel,
    canComplete:
      issuedOrHeld &&
      (canEdit || activeManager) &&
      resolved &&
      lines.length > 0 &&
      lines.every(({ quantity, received }) => quantity === received),
    note: visibleDeal ? record.note : null,
    charges: visibleDeal ? record.charges : null,
    currency: visibleDeal ? currency : null,
    lines,
    history: await returnCaseHistory(tx, scope),
  };
}

async function visibleSource(
  tx: Db,
  actor: HydratedActor,
  shipmentId: string,
  detail: ReturnDetail | null,
  warehouse: WarehouseAccess,
): Promise<ReturnSource> {
  const [row] = await tx
    .select({
      shipment: salesShipments,
      order: salesOrders,
      visibleDeal: visibleDealFor(actor),
    })
    .from(salesShipments)
    .innerJoin(salesOrders, eq(salesOrders.id, salesShipments.orderId))
    .leftJoin(deals, eq(deals.id, salesOrders.dealId))
    .leftJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .where(
      and(
        eq(salesShipments.id, shipmentId),
        eq(salesShipments.status, "shipped"),
        unrestrictedOrder(tx, actor),
      ),
    );
  if (row === undefined) failReturn("unavailable");
  const { order, shipment, visibleDeal } = row;
  const fullSource = visibleDeal || warehouse.sites.some(({ id }) => id === order.siteId);
  if (!fullSource && detail?.shipmentId !== shipmentId) failReturn("unavailable");

  const canCreate = await mayEditDeal(tx, actor, { visibleDeal, dealId: order.dealId });
  const ignoreCaseId = detail?.status === "draft" && detail.canEdit ? detail.id : undefined;
  const visibleLines = fullSource
    ? null
    : new Set(detail?.lines.map(({ shipmentLineId }) => shipmentLineId));
  const lines = await readReturnSourceLines(tx, shipmentId, ignoreCaseId);
  return {
    id: shipment.id,
    reference: shipment.reference,
    orderId: order.id,
    orderReference: order.reference,
    dealName: visibleDeal ? order.dealName : null,
    customerName: visibleDeal ? order.customerName : null,
    currency: visibleDeal ? order.currency : null,
    canCreate,
    lines: lines
      .filter(({ packed }) => visibleLines === null || visibleLines.has(packed.id))
      .map(({ packed, line, eligible }) => ({
        id: packed.id,
        code: line.partCode,
        name: line.partName,
        revision: line.partRevision,
        lot: packed.lot,
        serial: packed.serial,
        quantity: packed.quantity,
        eligible: fullSource ? eligible : 0,
        unitPrice: visibleDeal ? line.unitPrice : null,
      })),
  };
}

async function requireReturnsActor(tx: Db, who: NativeSessionRef, signal: AbortSignal) {
  const actor = await currentInventoryActor(tx, who, signal);
  if (actor === null || actor.projectsGuestOnly === true) failReturn("unavailable");
  return actor;
}

export async function readReturnsWorkspace(
  db: Db,
  who: NativeSessionRef,
  query: ReturnsQuery,
  signal: AbortSignal,
): Promise<ReturnsWorkspaceResult> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      await lockDirectory(tx, "read", signal);
      const actor = await requireReturnsActor(tx, who, signal);
      const warehouse = await readWarehouseAccess(tx, actor, signal);
      const scope = new Map(warehouse.sites.map((site) => [site.id, site]));
      const cases = await visibleCases(tx, actor, [...scope.keys()], query.shipmentId);
      const matching = cases.filter(
        ({ record }) => query.siteId === undefined || record.siteId === query.siteId,
      );
      const selected =
        query.caseId === undefined
          ? undefined
          : matching.find(({ record }) => record.id === query.caseId);
      if (query.caseId !== undefined && selected === undefined) failReturn("unavailable");
      const detail =
        selected === undefined ? null : await caseDetail(tx, actor, selected, warehouse);
      const shipmentId = query.shipmentId ?? detail?.shipmentId;
      const source =
        shipmentId === undefined
          ? null
          : await visibleSource(tx, actor, shipmentId, detail, warehouse);
      const historySites = new Set(cases.map(({ record }) => record.siteId));
      const sites = (await readSalesSites(tx)).filter(
        ({ id, archived }) =>
          scope.has(id) || historySites.has(id) || (source?.canCreate === true && !archived),
      );
      if (query.siteId !== undefined && !sites.some(({ id }) => id === query.siteId))
        failReturn("unavailable");
      const bins = warehouse.locations
        .filter(({ siteId, archived, kind }) => {
          const site = scope.get(siteId);
          return site?.canManage === true && !site.archived && !archived && kind === "storage";
        })
        .map(({ id, siteId, code, name }) => ({ id, siteId, code, name }));
      await requireReturnsActor(tx, who, signal);
      return ok({ sites, bins, source, cases: matching.map(caseSummary), detail });
    });
  } catch (error) {
    if (error instanceof ReturnFailure) return err(error.code);
    throw error;
  }
}
