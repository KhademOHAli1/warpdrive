import { and, desc, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { listOrgOptions } from "@/features/contacts/orgOptionsRepo";
import { currencyCode } from "@/features/currencies/currencySchema";
import { readBaseCurrency } from "@/features/settings/readBaseCurrency";
import type { HydratedActor } from "@/server/hydrateActor";
import { calculateStockUnits } from "../sourcing/contracts";
import { inventorySupplierOffers, inventorySupplierPriceTiers } from "../sourcing/schema";
import { lockSourcingRecords } from "../sourcing/scope";
import { lockInventoryStock } from "../stock";
import { inventoryStockEvents, inventoryStockIncoming } from "../warehouse/schema";
import type { PurchasingCommand } from "./contracts";
import { purchaseOrderLineCosts, purchaseOrderLines, purchaseOrders } from "./schema";
import {
  failPurchasing,
  readAvailablePurchaseOffers,
  readPurchaseParts,
  requirePurchaseLocation,
  requirePurchaseOrganizations,
} from "./scope";

type Draft = Extract<PurchasingCommand, { type: "saveDraft" }>;
type Issue = Extract<PurchasingCommand, { type: "issue" }>;
type Cancel = Extract<PurchasingCommand, { type: "cancel" }>;
export type PurchaseOrderRecord = typeof purchaseOrders.$inferSelect;
type OrderLine = typeof purchaseOrderLines.$inferSelect;

export async function readOrderLines(tx: Db, orderId: string) {
  return tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, orderId));
}

export async function lockPurchaseOrder(tx: Db, orderId: string): Promise<PurchaseOrderRecord> {
  const [order] = await tx
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, orderId))
    .for("update");
  if (order === undefined) failPurchasing("unavailable");
  return order;
}

async function readCurrentOffers(
  tx: Db,
  actor: HydratedActor,
  scope: Pick<Draft, "siteId" | "supplierOrganizationId">,
  offerIds: string[],
  signal: AbortSignal,
) {
  const ids = new Set(offerIds);
  if (ids.size !== offerIds.length) failPurchasing("invalid");
  const candidates = await tx
    .select({ itemId: inventorySupplierOffers.itemId })
    .from(inventorySupplierOffers)
    .where(
      and(
        eq(inventorySupplierOffers.siteId, scope.siteId),
        eq(inventorySupplierOffers.supplierOrganizationId, scope.supplierOrganizationId),
        inArray(inventorySupplierOffers.id, offerIds),
      ),
    );
  if (candidates.length !== ids.size) failPurchasing("unavailable");

  // Sourcing writes take the same per-item lock before locking the CRM organization rows.
  const itemIds = [...new Set(candidates.map(({ itemId }) => itemId))].sort();
  for (const itemId of itemIds) await lockSourcingRecords(tx, scope.siteId, itemId, "read", signal);

  const organizations = await listOrgOptions(tx, actor, signal);
  const parts = await readPurchaseParts(tx, actor);
  const eligible = await readAvailablePurchaseOffers(
    tx,
    scope.siteId,
    parts,
    organizations,
    offerIds,
  );
  const offers = eligible.filter(
    ({ offer }) => offer.supplierOrganizationId === scope.supplierOrganizationId,
  );
  if (offers.length !== ids.size) failPurchasing("stale");
  await requirePurchaseOrganizations(tx, actor, [
    scope.supplierOrganizationId,
    ...offers.flatMap(({ manufacturerOrganizationId }) =>
      manufacturerOrganizationId === null ? [] : [manufacturerOrganizationId],
    ),
  ]);
  return new Map(offers.map(({ offer }) => [offer.id, offer]));
}

export async function savePurchaseDraft(
  tx: Db,
  actor: HydratedActor,
  command: Draft,
  current: PurchaseOrderRecord | null,
  signal: AbortSignal,
): Promise<string> {
  if (
    current !== null &&
    (current.version !== command.expectedVersion ||
      current.status !== "draft" ||
      current.siteId !== command.siteId)
  ) {
    failPurchasing("stale");
  }

  await requirePurchaseLocation(tx, command.siteId, command.locationId);
  const offers = await readCurrentOffers(
    tx,
    actor,
    command,
    command.lines.map(({ offerId }) => offerId),
    signal,
  );
  const orderId = current?.id ?? command.requestId;
  const metadata = {
    locationId: command.locationId,
    supplierOrganizationId: command.supplierOrganizationId,
    reference: command.reference,
    expectedDate: command.expectedDate,
  };
  if (current === null) {
    const [created] = await tx
      .insert(purchaseOrders)
      .values({ ...metadata, id: orderId, siteId: command.siteId, createdBy: actor.id })
      .onConflictDoNothing()
      .returning({ id: purchaseOrders.id });
    if (created === undefined) failPurchasing("conflict");
  } else {
    await tx
      .update(purchaseOrders)
      .set({ ...metadata, version: current.version + 1, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, orderId));
    await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, orderId));
  }

  await tx.insert(purchaseOrderLines).values(
    command.lines.map(({ offerId, packs }) => {
      const offer = offers.get(offerId);
      if (offer === undefined) failPurchasing("unavailable");
      const {
        version,
        itemId,
        partCode,
        partName,
        revision,
        partNumber,
        stockUnit,
        packQuantity,
        trackable,
      } = offer;
      const orderedUnits = calculateStockUnits(packs, packQuantity);
      if (orderedUnits === null) failPurchasing("invalid");
      return {
        orderId,
        siteId: command.siteId,
        offerId,
        offerVersion: version,
        itemId,
        partCode,
        partName,
        revision,
        partNumber,
        stockUnit,
        packQuantity,
        trackable,
        packs,
        orderedUnits,
      };
    }),
  );
  return orderId;
}

async function recordIssuedCost(tx: Db, line: OrderLine, currency: string) {
  const prices = inventorySupplierPriceTiers;
  const [quote] = await tx
    .select({ amount: prices.amount, minPacks: prices.minPacks })
    .from(prices)
    .where(
      and(
        eq(prices.offerId, line.offerId),
        eq(prices.currency, currency),
        eq(prices.packQuantity, line.packQuantity),
        eq(prices.stockUnit, line.stockUnit),
        // One row at the largest minimum the quoted pack count satisfies.
        lte(prices.minPacks, line.packs),
      ),
    )
    .orderBy(desc(prices.minPacks))
    .limit(1);
  if (quote !== undefined) {
    await tx.insert(purchaseOrderLineCosts).values({ lineId: line.id, currency, ...quote });
  }
}

export async function issuePurchaseOrder(
  tx: Db,
  actor: HydratedActor,
  order: PurchaseOrderRecord,
  lines: OrderLine[],
  command: Issue,
  signal: AbortSignal,
) {
  if (order.status !== "draft" || order.version !== command.expectedVersion || lines.length === 0) {
    failPurchasing("stale");
  }
  await requirePurchaseLocation(tx, order.siteId, order.locationId);
  const offers = await readCurrentOffers(
    tx,
    actor,
    order,
    lines.map(({ offerId }) => offerId),
    signal,
  );
  await lockInventoryStock(
    tx,
    lines.map(({ itemId }) => itemId),
  );

  const currency = currencyCode.safeParse(await readBaseCurrency(tx, signal));
  for (const line of lines) {
    const offer = offers.get(line.offerId);
    if (
      offer === undefined ||
      offer.version !== line.offerVersion ||
      offer.itemId !== line.itemId ||
      offer.packQuantity !== line.packQuantity ||
      offer.stockUnit !== line.stockUnit
    ) {
      failPurchasing("stale");
    }

    const [plan] = await tx
      .insert(inventoryStockIncoming)
      .values({
        itemId: line.itemId,
        siteId: order.siteId,
        locationId: order.locationId,
        quantity: line.orderedUnits,
        expectedDate: order.expectedDate,
        reference: order.reference,
      })
      .returning({ id: inventoryStockIncoming.id });
    if (plan === undefined) failPurchasing("conflict");

    await tx
      .update(purchaseOrderLines)
      .set({
        incomingId: plan.id,
        partCode: offer.partCode,
        partName: offer.partName,
        revision: offer.revision,
        partNumber: offer.partNumber,
        trackable: offer.trackable,
      })
      .where(eq(purchaseOrderLines.id, line.id));
    await tx.insert(inventoryStockEvents).values({
      itemId: line.itemId,
      incomingId: plan.id,
      actorId: actor.id,
      requestId: command.requestId,
      kind: "incoming-create",
      incomingDelta: line.orderedUnits,
    });
    if (currency.success) await recordIssuedCost(tx, line, currency.data);
  }

  const now = new Date();
  await tx
    .update(purchaseOrders)
    .set({ status: "open", issuedAt: now, updatedAt: now, version: order.version + 1 })
    .where(eq(purchaseOrders.id, order.id));
}

export async function cancelPurchaseOrder(
  tx: Db,
  actor: HydratedActor,
  order: PurchaseOrderRecord,
  lines: OrderLine[],
  command: Cancel,
) {
  if (
    order.version !== command.expectedVersion ||
    (order.status !== "draft" && order.status !== "open" && order.status !== "partial")
  ) {
    failPurchasing("stale");
  }

  if (order.status !== "draft") {
    await lockInventoryStock(
      tx,
      lines.map(({ itemId }) => itemId),
    );
    for (const line of lines) {
      if (line.incomingId === null) failPurchasing("stale");
      const [plan] = await tx
        .select()
        .from(inventoryStockIncoming)
        .where(eq(inventoryStockIncoming.id, line.incomingId))
        .for("update");
      if (
        plan === undefined ||
        plan.cancelled ||
        plan.itemId !== line.itemId ||
        plan.siteId !== order.siteId ||
        plan.locationId !== order.locationId ||
        plan.quantity !== line.orderedUnits
      ) {
        failPurchasing("stale");
      }
      const outstanding = plan.quantity - plan.received;
      if (outstanding === 0) continue;
      await tx
        .update(inventoryStockIncoming)
        .set({ cancelled: true })
        .where(eq(inventoryStockIncoming.id, plan.id));
      await tx.insert(inventoryStockEvents).values({
        itemId: line.itemId,
        incomingId: plan.id,
        actorId: actor.id,
        requestId: command.requestId,
        kind: "incoming-cancel",
        incomingDelta: -outstanding,
      });
    }
  }

  await tx
    .update(purchaseOrders)
    .set({
      status: "cancelled",
      cancellationReason: command.reason,
      updatedAt: new Date(),
      version: order.version + 1,
    })
    .where(eq(purchaseOrders.id, order.id));
}
