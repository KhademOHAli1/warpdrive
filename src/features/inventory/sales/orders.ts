import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals, pipelines } from "@/db/schema";
import type { HydratedActor } from "@/server/hydrateActor";
import type { SalesCommand } from "./contracts";
import { failSales } from "./failure";
import { releaseAllSalesAllocations } from "./fulfillment";
import { salesStockPolicy } from "./fulfillmentStock";
import { type SalesLineRow, type SalesOrderRow, salesOrderLines, salesOrders } from "./schema";
import { readSalesDeal, readSalesPartAccess, readSalesSites, readSellableParts } from "./scope";

type SaveDraft = Extract<SalesCommand, { type: "saveDraft" }>;

export function readSalesOrderLines(tx: Db, orderId: string) {
  return tx
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, orderId))
    .orderBy(asc(salesOrderLines.ordinal));
}

export async function isInactiveSalesDeal(tx: Db, dealId: string | null) {
  if (dealId === null) return true;
  const [row] = await tx
    .select({
      archivedAt: deals.archivedAt,
      deletedAt: deals.deletedAt,
      archivedPipeline: pipelines.isArchived,
    })
    .from(deals)
    .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .where(eq(deals.id, dealId));
  return (
    row === undefined || row.archivedAt !== null || row.deletedAt !== null || row.archivedPipeline
  );
}

export async function saveSalesDraft(
  tx: Db,
  actor: HydratedActor,
  order: SalesOrderRow | null,
  input: SaveDraft,
) {
  if (order !== null && order.status !== "draft") failSales("state");
  const deal = await readSalesDeal(tx, actor, input.dealId);
  if (deal?.canOrder !== true) failSales("unavailable");
  if (!(await readSalesSites(tx)).some(({ id, archived }) => id === input.siteId && !archived))
    failSales("unavailable");
  const access = await readSalesPartAccess(tx, actor);
  if (input.lines.some(({ itemId }) => !access.sellable.has(itemId))) failSales("invalid");
  const parts = new Map(
    (await readSellableParts(tx, new Set(input.lines.map(({ itemId }) => itemId)))).map((part) => [
      part.id,
      part,
    ]),
  );
  const id = order?.id ?? input.requestId;
  const snapshot = {
    dealId: deal.id,
    siteId: input.siteId,
    reference: input.reference,
    dueDate: input.dueDate,
    dealName: deal.name,
    customerName: deal.customerName,
    recipient: input.recipient,
    address: input.address,
    currency: input.currency,
    charges: input.charges,
  };
  if (order === null) {
    await tx.insert(salesOrders).values({ id, ...snapshot, createdBy: actor.id });
  } else {
    await tx.update(salesOrders).set(snapshot).where(eq(salesOrders.id, id));
    await tx.delete(salesOrderLines).where(eq(salesOrderLines.orderId, id));
  }
  await tx.insert(salesOrderLines).values(
    input.lines.map((line, ordinal) => {
      const part = parts.get(line.itemId);
      if (part === undefined) failSales("unavailable");
      return {
        ...line,
        ordinal,
        orderId: id,
        partCode: part.code,
        partName: part.name,
        partRevision: part.revision,
        stockUnit: part.unit,
      };
    }),
  );
  return id;
}

export async function issueSalesOrder(
  tx: Db,
  actorId: string,
  order: SalesOrderRow,
  lines: SalesLineRow[],
) {
  if (order.status !== "draft" || lines.length === 0) failSales("state");
  if (!(await readSalesSites(tx)).some(({ id, archived }) => id === order.siteId && !archived))
    failSales("unavailable");
  for (const line of lines) {
    if ((await salesStockPolicy(tx, line)) === null) failSales("state");
  }
  await tx
    .update(salesOrders)
    .set({ status: "issued", issuedBy: actorId, issuedAt: sql`clock_timestamp()` })
    .where(eq(salesOrders.id, order.id));
}

export async function cancelSalesOrder(
  tx: Db,
  actorId: string,
  order: SalesOrderRow,
  lines: SalesLineRow[],
  command: Extract<SalesCommand, { type: "cancelOrder" }>,
) {
  if (order.status !== "draft" && order.status !== "issued") failSales("state");
  if (order.status === "issued")
    await releaseAllSalesAllocations(tx, actorId, order, lines, command.requestId);
  await tx
    .update(salesOrders)
    .set({
      status: "cancelled",
      cancelledBy: actorId,
      cancelledAt: sql`clock_timestamp()`,
      cancellationReason: command.reason,
    })
    .where(eq(salesOrders.id, order.id));
}
