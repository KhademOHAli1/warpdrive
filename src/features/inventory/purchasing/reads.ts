import { and, asc, eq, exists, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { listOrgOptions } from "@/features/contacts/orgOptionsRepo";
import { lockDirectory } from "@/features/locations/service";
import { currentOperationsActor } from "@/features/operations-access/scope";
import type { HydratedActor } from "@/server/hydrateActor";
import { lockInventoryCatalog } from "../catalog/policy";
import { inventoryProductionBuilds, inventoryProductionOutputs } from "../production/buildSchema";
import { inventoryQualityTargets } from "../quality/schema";
import { inventoryReleaseGrants } from "../releases/schema";
import {
  inventorySubcontractDispatches,
  inventorySubcontractReceipts,
  inventorySubcontracts,
} from "../subcontract/schema";
import { readOrderWarehouseSites } from "../warehouse/legacyScope";
import { inventoryStockIncoming } from "../warehouse/schema";
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchasePrice,
  PurchaseReceipt,
  PurchasingQuery,
  PurchasingResult,
  PurchasingWorkspace,
} from "./contracts";
import {
  purchaseOrderLineCosts,
  purchaseOrderLines,
  purchaseOrders,
  purchaseReceiptLines,
  purchaseReceipts,
} from "./schema";
import {
  type PurchaseSiteAccess,
  purchaseLocationChoices,
  readAvailablePurchaseOffers,
  readPurchaseLocations,
  readPurchaseParts,
  readPurchaseSiteAccess,
} from "./scope";

const unavailable = { ok: false, error: "unavailable" } as const;
type Parts = Awaited<ReturnType<typeof readPurchaseParts>>;

export function readPurchasingScope(db: Db, who: NativeSessionRef, signal: AbortSignal) {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockDirectory(tx, "read", signal);
    const actor = await currentOperationsActor(tx, who, signal);
    if (actor === null) return unavailable;
    const sites = (await readPurchaseSiteAccess(tx, actor)).map(({ site }) => site);
    if ((await currentOperationsActor(tx, who, signal)) === null) return unavailable;
    return { ok: true, value: { sites } } as const;
  });
}

function groupBy<K, T>(rows: T[], key: (row: T) => K) {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const value = key(row);
    const existing = groups.get(value);
    if (existing === undefined) groups.set(value, [row]);
    else existing.push(row);
  }
  return groups;
}

async function projectOrderLines(tx: Db, orderIds: string[]) {
  const table = purchaseOrderLines;
  const rows = await tx
    .select({
      orderId: table.orderId,
      line: {
        id: table.id,
        offerId: table.offerId,
        itemId: table.itemId,
        partNumber: table.partNumber,
        partCode: table.partCode,
        partName: table.partName,
        revision: table.revision,
        packQuantity: table.packQuantity,
        stockUnit: table.stockUnit,
        packs: table.packs,
        orderedUnits: table.orderedUnits,
        trackable: table.trackable,
      },
      planReceived: inventoryStockIncoming.received,
    })
    .from(table)
    .leftJoin(inventoryStockIncoming, eq(inventoryStockIncoming.id, table.incomingId))
    .where(inArray(table.orderId, orderIds))
    .orderBy(asc(table.partCode), asc(table.id));
  return groupBy(rows, ({ orderId }) => orderId);
}

async function projectOrderReceipts(tx: Db, orderIds: string[]) {
  const rows = await tx
    .select({
      id: purchaseReceipts.id,
      orderId: purchaseReceipts.orderId,
      supplierSlip: purchaseReceipts.supplierSlip,
      postedAt: purchaseReceipts.createdAt,
    })
    .from(purchaseReceipts)
    .where(inArray(purchaseReceipts.orderId, orderIds))
    .orderBy(asc(purchaseReceipts.createdAt), asc(purchaseReceipts.id));
  const table = purchaseReceiptLines;
  const lines = await tx
    .select({
      receiptId: table.receiptId,
      line: {
        id: table.id,
        lineId: table.lineId,
        quantity: table.quantity,
        lot: table.lot,
        serial: table.serial,
        expiryDate: table.expiryDate,
        disposition: table.disposition,
        reason: table.reason,
        positionId: table.positionId,
      },
      outputStatus: inventoryProductionOutputs.status,
      heldForInspection: sql<boolean>`EXISTS (
        SELECT 1 FROM ${inventoryQualityTargets}
        WHERE ${inventoryQualityTargets.positionId} = ${inventorySubcontractReceipts.positionId}
          AND ${ne(inventoryQualityTargets.status, "passed")}
      )`,
    })
    .from(table)
    .leftJoin(
      inventorySubcontractReceipts,
      eq(inventorySubcontractReceipts.receiptLineId, table.id),
    )
    .leftJoin(
      inventoryProductionOutputs,
      eq(inventoryProductionOutputs.id, inventorySubcontractReceipts.outputId),
    )
    .where(
      inArray(
        table.receiptId,
        rows.map(({ id }) => id),
      ),
    )
    .orderBy(asc(table.id));
  const lineGroups = groupBy(lines, ({ receiptId }) => receiptId);
  return groupBy(
    rows.map(({ postedAt, ...row }) => ({
      ...row,
      postedAt: postedAt.toISOString(),
      lines: (lineGroups.get(row.id) ?? []).map(({ line, outputStatus, heldForInspection }) => ({
        ...line,
        ...(outputStatus === "wip" ? { heldForRelease: true as const } : {}),
        ...(heldForInspection ? { heldForInspection: true as const } : {}),
      })),
    })),
    ({ orderId }) => orderId,
  );
}

async function projectSubcontracts(
  tx: Db,
  actor: HydratedActor,
  siteId: string,
  orderIds: string[],
) {
  const managedSites = await readOrderWarehouseSites(tx, actor);
  const canReadBuilds = managedSites === null || managedSites.includes(siteId);
  const engineering =
    actor.type === "admin"
      ? sql`true`
      : exists(
          tx
            .select({ allowed: sql`1` })
            .from(inventoryReleaseGrants)
            .where(
              and(
                eq(inventoryReleaseGrants.userId, actor.id),
                eq(inventoryReleaseGrants.itemId, inventoryProductionBuilds.itemId),
              ),
            ),
        );
  const dispatch = inventorySubcontractDispatches;
  const subcontract = inventorySubcontracts;
  const linked = await tx
    .select({
      lineId: subcontract.lineId,
      orderId: subcontract.orderId,
      buildId: subcontract.buildId,
      canOpenBuild: sql<boolean>`${canReadBuilds} AND ${engineering}`,
      outstandingCustody: exists(
        tx
          .select({ pending: sql`1` })
          .from(dispatch)
          .where(
            and(
              eq(dispatch.buildId, subcontract.buildId),
              sql`${dispatch.quantity} > ${dispatch.consumed} + ${dispatch.returned}`,
            ),
          ),
      ),
    })
    .from(subcontract)
    .innerJoin(inventoryProductionBuilds, eq(inventoryProductionBuilds.id, subcontract.buildId))
    .where(inArray(subcontract.orderId, orderIds));
  return {
    byLine: new Map(
      linked.map(({ lineId, buildId, canOpenBuild }) => [
        lineId,
        {
          subcontracted: true as const,
          ...(canOpenBuild ? { subcontractBuildId: buildId } : {}),
        },
      ]),
    ),
    pendingCustody: new Set(
      linked
        .filter(({ outstandingCustody }) => outstandingCustody === true)
        .map(({ orderId }) => orderId),
    ),
  };
}

async function readOrdersForSite(
  tx: Db,
  actor: HydratedActor,
  access: PurchaseSiteAccess,
  parts: Parts,
  organizations: ReadonlyMap<string, string>,
  locations: ReadonlyMap<string, string>,
): Promise<PurchaseOrder[]> {
  const { site, canBrowseDrafts } = access;
  // Hold the parent stable while projecting incoming balances and receipt batches.
  const orders = await tx
    .select()
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.siteId, site.id),
        canBrowseDrafts ? undefined : isNotNull(purchaseOrders.issuedAt),
      ),
    )
    .orderBy(asc(purchaseOrders.id))
    .for("share");
  const scopedOrders = orders.filter(({ supplierOrganizationId }) =>
    organizations.has(supplierOrganizationId),
  );
  if (scopedOrders.length === 0) return [];
  const orderLines = await projectOrderLines(
    tx,
    scopedOrders.map(({ id }) => id),
  );
  const visibleOrders = scopedOrders.filter(({ id }) =>
    (orderLines.get(id) ?? []).every(({ line }) => parts.has(line.itemId)),
  );
  if (visibleOrders.length === 0) return [];
  const receipts = await projectOrderReceipts(
    tx,
    visibleOrders.map(({ id }) => id),
  );
  const subcontracts = await projectSubcontracts(
    tx,
    actor,
    site.id,
    visibleOrders.map(({ id }) => id),
  );
  const prices = site.canReadCosts
    ? await tx
        .select()
        .from(purchaseOrderLineCosts)
        .where(
          inArray(
            purchaseOrderLineCosts.lineId,
            visibleOrders.flatMap(({ id }) =>
              (orderLines.get(id) ?? []).map(({ line }) => line.id),
            ),
          ),
        )
    : [];
  const priceByLine = new Map(prices.map((price) => [price.lineId, price]));
  return visibleOrders
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id))
    .map((order): PurchaseOrder => {
      const lines: PurchaseOrderLine[] = (orderLines.get(order.id) ?? []).map(
        ({ line, planReceived }) => ({
          ...line,
          receivedUnits: planReceived ?? 0,
          ...subcontracts.byLine.get(line.id),
        }),
      );
      const orderReceipts: PurchaseReceipt[] = (receipts.get(order.id) ?? []).map(
        ({ id, supplierSlip, postedAt, lines }) => ({ id, supplierSlip, postedAt, lines }),
      );
      const pricing: PurchasePrice[] = lines.flatMap(({ id }) => {
        const price = priceByLine.get(id);
        return price === undefined ? [] : [price];
      });
      const pending = order.status === "open" || order.status === "partial";
      return {
        id: order.id,
        siteId: order.siteId,
        locationId: order.locationId,
        locationName: locations.get(order.locationId) ?? "",
        supplierOrganizationId: order.supplierOrganizationId,
        supplierName: organizations.get(order.supplierOrganizationId) ?? "",
        reference: order.reference,
        expectedDate: order.expectedDate,
        status: order.status,
        version: order.version,
        canEdit: site.canBuy && (order.status === "draft" || pending),
        canReceive: site.canReceive && pending,
        ...(subcontracts.pendingCustody.has(order.id) ||
        orderReceipts.some((receipt) =>
          receipt.lines.some(
            ({ heldForRelease, heldForInspection }) =>
              heldForRelease === true || heldForInspection === true,
          ),
        )
          ? { subcontractCancellationBlocked: true as const }
          : {}),
        lines,
        receipts: orderReceipts,
        ...(site.canReadCosts ? { pricing } : {}),
      };
    });
}

async function projectWorkspace(
  tx: Db,
  actor: HydratedActor,
  query: PurchasingQuery,
  signal: AbortSignal,
): Promise<PurchasingWorkspace | null> {
  const access = await readPurchaseSiteAccess(tx, actor);
  const sites = access.map(({ site }) => site);
  if (sites.length === 0 && actor.type !== "admin") return null;

  let siteId = query.siteId;
  if (siteId === undefined && query.orderId !== undefined) {
    const [target] = await tx
      .select({ siteId: purchaseOrders.siteId })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, query.orderId));
    if (target === undefined) return null;
    siteId = target.siteId;
  }
  const selection =
    siteId === undefined
      ? (access.find(({ site }) => !site.archived) ?? access[0])
      : access.find(({ site }) => site.id === siteId);
  if (selection === undefined) {
    if (siteId !== undefined || query.orderId !== undefined) return null;
    return {
      sites,
      selectedSiteId: null,
      selectedOrderId: null,
      locations: [],
      organizations: [],
      offers: [],
      orders: [],
    };
  }

  const { site } = selection;
  const organizations = await listOrgOptions(tx, actor, signal);
  const parts = await readPurchaseParts(tx, actor);
  const locationRows = await readPurchaseLocations(tx, site.id);
  const orders = await readOrdersForSite(
    tx,
    actor,
    selection,
    parts,
    new Map(organizations.map(({ id, name }) => [id, name])),
    new Map(locationRows.map(({ id, name }) => [id, name])),
  );
  if (query.orderId !== undefined && !orders.some(({ id }) => id === query.orderId)) return null;

  const eligible = site.canBuy
    ? await readAvailablePurchaseOffers(tx, site.id, parts, organizations)
    : [];
  return {
    sites,
    selectedSiteId: site.id,
    selectedOrderId: query.orderId ?? orders[0]?.id ?? null,
    locations: site.canBuy ? purchaseLocationChoices(locationRows) : [],
    organizations: site.canBuy ? organizations : [],
    offers: eligible.map(({ offer }) => offer),
    orders,
  };
}

export function readPurchasingWorkspace(
  db: Db,
  who: NativeSessionRef,
  query: PurchasingQuery,
  signal: AbortSignal,
): Promise<PurchasingResult> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockInventoryCatalog(tx, signal);
    await lockDirectory(tx, "read", signal);
    const actor = await currentOperationsActor(tx, who, signal);
    if (actor === null) return unavailable;
    const workspace = await projectWorkspace(tx, actor, query, signal);
    if (workspace === null || (await currentOperationsActor(tx, who, signal)) === null)
      return unavailable;
    return { ok: true, value: workspace };
  });
}
