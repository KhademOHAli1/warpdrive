import { and, asc, desc, eq, gt, gte, isNull, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { currencyCode } from "@/features/currencies/currencySchema";
import { directoryLocations } from "@/features/locations/schema";
import { readBaseCurrency } from "@/features/settings/readBaseCurrency";
import type { CatalogUnit } from "../../catalog/contracts";
import { inventoryPartFamilies, inventoryPartProfiles } from "../../catalog/schema";
import {
  purchaseOrderLineCosts,
  purchaseOrderLines,
  purchaseReceiptLines,
} from "../../purchasing/schema";
import { inventoryItems } from "../../schema";
import { inventoryItemCostOverrides } from "../../sourcing/schema";
import type { OperationsActor } from "../operations/shared";
import {
  inventoryStockEventDetails,
  inventoryStockEvents,
  inventoryStockPositions,
} from "../schema";
import type {
  ValuationCommand,
  ValuationDetail,
  ValuationLine,
  ValuationSummary,
} from "./contracts";
import { failStocktake } from "./errors";
import { inventoryValuationLines, inventoryValuationSnapshots } from "./valuationSchema";

const positions = inventoryStockPositions;
const stockUnit = sql<CatalogUnit>`coalesce(${inventoryPartProfiles.unit}, 'each')`;

function readValuationPositions(tx: Db, siteId: string, currency: string) {
  const addedStock = alias(inventoryStockEvents, "other_valuation_stock_event");
  const receiptPrice = tx
    .select({
      receiptLineId: purchaseReceiptLines.id,
      amount: purchaseOrderLineCosts.amount,
      packQuantity: purchaseOrderLines.packQuantity,
    })
    .from(inventoryStockEvents)
    .innerJoin(
      inventoryStockEventDetails,
      eq(inventoryStockEventDetails.eventId, inventoryStockEvents.id),
    )
    .innerJoin(purchaseReceiptLines, eq(purchaseReceiptLines.eventId, inventoryStockEvents.id))
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.id, purchaseReceiptLines.lineId))
    .innerJoin(purchaseOrderLineCosts, eq(purchaseOrderLineCosts.lineId, purchaseOrderLines.id))
    .where(
      and(
        eq(inventoryStockEvents.positionId, positions.id),
        eq(inventoryStockEvents.kind, "receipt"),
        eq(inventoryStockEventDetails.siteId, positions.siteId),
        eq(purchaseReceiptLines.positionId, positions.id),
        eq(purchaseReceiptLines.disposition, "accepted"),
        eq(purchaseReceiptLines.quantity, inventoryStockEvents.onHandDelta),
        gte(purchaseReceiptLines.quantity, positions.onHand),
        eq(purchaseOrderLines.itemId, positions.itemId),
        eq(purchaseOrderLines.siteId, positions.siteId),
        eq(purchaseOrderLines.stockUnit, stockUnit),
        eq(purchaseOrderLineCosts.currency, currency),
        // A second physical addition can change the cost basis of the remaining stock.
        notExists(
          tx
            .select({ id: addedStock.id })
            .from(addedStock)
            .where(
              and(
                eq(addedStock.positionId, positions.id),
                gt(addedStock.onHandDelta, 0),
                ne(addedStock.id, inventoryStockEvents.id),
              ),
            ),
        ),
      ),
    )
    .limit(1)
    .as("valuation_receipt_price");

  return tx
    .select({
      positionId: positions.id,
      itemId: positions.itemId,
      locationId: positions.locationId,
      locationName: directoryLocations.name,
      code: sql<string>`coalesce(${inventoryPartFamilies.code}, ${inventoryItems.sku})`,
      name: inventoryItems.name,
      revision: inventoryItems.revision,
      stockUnit,
      quantity: positions.onHand,
      reserved: positions.reserved,
      stockState: positions.state,
      lot: positions.lot,
      serial: positions.serial,
      visibility: inventoryPartProfiles.visibility,
      overrideAmount: inventoryItemCostOverrides.amount,
      receipt: {
        id: receiptPrice.receiptLineId,
        amount: receiptPrice.amount,
        packQuantity: receiptPrice.packQuantity,
      },
    })
    .from(positions)
    .innerJoin(inventoryItems, eq(inventoryItems.id, positions.itemId))
    .innerJoin(directoryLocations, eq(directoryLocations.id, positions.locationId))
    .leftJoin(inventoryPartProfiles, eq(inventoryPartProfiles.itemId, positions.itemId))
    .leftJoin(inventoryPartFamilies, eq(inventoryPartFamilies.id, inventoryPartProfiles.familyId))
    .leftJoin(
      inventoryItemCostOverrides,
      and(
        eq(inventoryItemCostOverrides.itemId, positions.itemId),
        eq(inventoryItemCostOverrides.siteId, positions.siteId),
        eq(inventoryItemCostOverrides.currency, currency),
      ),
    )
    .leftJoinLateral(receiptPrice, isNull(inventoryItemCostOverrides.amount))
    .where(
      and(
        eq(positions.siteId, siteId),
        isNull(positions.ownerOrganizationId),
        gt(positions.onHand, 0),
      ),
    );
}

const MONEY_SCALE = 10_000n;

function extendPrice(amount: string, quantity: number, packQuantity: number): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  const scaledAmount = BigInt(whole) * MONEY_SCALE + BigInt(fraction.padEnd(4, "0"));
  const divisor = BigInt(packQuantity);
  // Round the extended value once, using the full per-pack price.
  const extended = (scaledAmount * BigInt(quantity) + divisor / 2n) / divisor;
  return `${extended / MONEY_SCALE}.${String(extended % MONEY_SCALE).padStart(4, "0")}`;
}

type CapturedPosition = Awaited<ReturnType<typeof readValuationPositions>>[number];

function valuationBasis(
  overrideAmount: CapturedPosition["overrideAmount"],
  receipt: CapturedPosition["receipt"],
  quantity: number,
) {
  if (overrideAmount !== null) {
    return {
      source: "override" as const,
      basisAmount: overrideAmount,
      basisPackQuantity: 1,
      receiptLineId: null,
      value: extendPrice(overrideAmount, quantity, 1),
    };
  }
  if (receipt !== null) {
    return {
      source: "purchase_receipt" as const,
      basisAmount: receipt.amount,
      basisPackQuantity: receipt.packQuantity,
      receiptLineId: receipt.id,
      value: extendPrice(receipt.amount, quantity, receipt.packQuantity),
    };
  }
  return {
    source: "unvalued" as const,
    basisAmount: null,
    basisPackQuantity: null,
    receiptLineId: null,
    value: null,
  };
}

export async function captureValuation(
  tx: Db,
  actor: OperationsActor,
  command: ValuationCommand,
  signal: AbortSignal,
): Promise<string> {
  const currency = currencyCode.safeParse(await readBaseCurrency(tx, signal));
  if (!currency.success) failStocktake("invalid");

  const rows = await readValuationPositions(tx, command.siteId, currency.data);
  signal.throwIfAborted();

  // A header and its line inserts are committed in the caller's fenced transaction.
  const [snapshot] = await tx
    .insert(inventoryValuationSnapshots)
    .values({
      id: command.requestId,
      siteId: command.siteId,
      label: command.label,
      currency: currency.data,
      capturedBy: actor.id,
    })
    .onConflictDoNothing()
    .returning({ id: inventoryValuationSnapshots.id });
  if (snapshot === undefined) failStocktake("conflict");

  const batchSize = 200;
  for (let start = 0; start < rows.length; start += batchSize) {
    signal.throwIfAborted();
    await tx.insert(inventoryValuationLines).values(
      rows
        .slice(start, start + batchSize)
        .map(({ visibility, receipt, overrideAmount, ...line }) => {
          // A site total containing a hidden part cannot be shared with this actor.
          if (!actor.access.isAdmin && visibility === "admin") failStocktake("unavailable");
          return {
            ...line,
            ...valuationBasis(overrideAmount, receipt, line.quantity),
            siteId: command.siteId,
            snapshotId: snapshot.id,
          };
        }),
    );
  }
  await tx
    .update(inventoryValuationSnapshots)
    .set({ sealed: true })
    .where(eq(inventoryValuationSnapshots.id, snapshot.id));
  return snapshot.id;
}

const snapshots = inventoryValuationSnapshots;
const lines = inventoryValuationLines;

function scopedSummaries(tx: Db, actor: OperationsActor, siteId: string) {
  const scopedLine = alias(lines, "scoped_valuation_line");
  const hiddenLines = tx
    .select({ id: scopedLine.id })
    .from(scopedLine)
    .innerJoin(inventoryPartProfiles, eq(inventoryPartProfiles.itemId, scopedLine.itemId))
    .where(
      and(eq(scopedLine.snapshotId, snapshots.id), eq(inventoryPartProfiles.visibility, "admin")),
    );
  return tx
    .select({
      id: snapshots.id,
      label: snapshots.label,
      currency: snapshots.currency,
      capturedAt: snapshots.capturedAt,
      positions: sql<string>`count(${lines.id})::text`,
      quantity: sql<string>`coalesce(sum(${lines.quantity}), 0)::text`,
      reserved: sql<string>`coalesce(sum(${lines.reserved}), 0)::text`,
      unvaluedQuantity: sql<string>`coalesce(sum(${lines.quantity}) filter (
        where ${lines.source} = 'unvalued'), 0)::text`,
      totalValue: sql<string>`coalesce(sum(${lines.value}), 0)::numeric(38, 4)::text`,
    })
    .from(snapshots)
    .leftJoin(lines, eq(lines.snapshotId, snapshots.id))
    .where(
      and(
        eq(snapshots.siteId, siteId),
        eq(snapshots.sealed, true),
        actor.access.isAdmin ? undefined : notExists(hiddenLines),
      ),
    )
    .groupBy(snapshots.id)
    .orderBy(desc(snapshots.capturedAt), desc(snapshots.id));
}

function exactQuantity(raw: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) failStocktake("limit");
  return value;
}

function valuationLines(tx: Db, snapshotId: string): PromiseLike<ValuationLine[]> {
  return tx
    .select({
      id: lines.id,
      positionId: lines.positionId,
      itemId: lines.itemId,
      locationId: lines.locationId,
      locationName: lines.locationName,
      code: lines.code,
      name: lines.name,
      revision: lines.revision,
      stockUnit: lines.stockUnit,
      quantity: lines.quantity,
      reserved: lines.reserved,
      stockState: lines.stockState,
      lot: lines.lot,
      serial: lines.serial,
      source: lines.source,
      basisAmount: lines.basisAmount,
      basisPackQuantity: lines.basisPackQuantity,
      value: lines.value,
    })
    .from(lines)
    .where(eq(lines.snapshotId, snapshotId))
    .orderBy(asc(lines.locationName), asc(lines.code), asc(lines.revision), asc(lines.positionId));
}

export async function readValuations(
  tx: Db,
  actor: OperationsActor,
  siteId: string,
  valuationId?: string,
): Promise<{ valuations: ValuationSummary[]; valuation: ValuationDetail | null }> {
  const rows = await scopedSummaries(tx, actor, siteId);
  const valuations = rows.map(
    ({ capturedAt, positions, quantity, reserved, unvaluedQuantity, ...row }) => ({
      ...row,
      capturedAt: capturedAt.toISOString(),
      positions: exactQuantity(positions),
      quantity: exactQuantity(quantity),
      reserved: exactQuantity(reserved),
      unvaluedQuantity: exactQuantity(unvaluedQuantity),
    }),
  );
  if (valuationId === undefined) return { valuations, valuation: null };
  const selected = valuations.find(({ id }) => id === valuationId);
  if (selected === undefined) failStocktake("unavailable");
  return {
    valuations,
    valuation: { ...selected, lines: await valuationLines(tx, valuationId) },
  };
}
