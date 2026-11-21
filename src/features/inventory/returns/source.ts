import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { salesOrderLines, salesOrders, salesShipmentLines, salesShipments } from "../sales/schema";
import { failReturn } from "./failure";
import { returnCases, returnLines, returnReceipts } from "./schema";

export async function readReturnShipment(tx: Db, shipmentId: string, lock = false) {
  const query = tx
    .select({ shipment: salesShipments, order: salesOrders })
    .from(salesShipments)
    .innerJoin(salesOrders, eq(salesOrders.id, salesShipments.orderId))
    .where(and(eq(salesShipments.id, shipmentId), eq(salesShipments.status, "shipped")));
  const [source] = await (lock ? query.for("update", { of: salesShipments }) : query);
  if (source === undefined) failReturn("unavailable");
  return source;
}

export async function readReturnSourceLines(tx: Db, shipmentId: string, ignoreCaseId?: string) {
  const packed = await tx
    .select({ packed: salesShipmentLines, line: salesOrderLines })
    .from(salesShipmentLines)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, salesShipmentLines.lineId))
    .where(eq(salesShipmentLines.shipmentId, shipmentId))
    .orderBy(asc(salesOrderLines.ordinal), asc(salesShipmentLines.id));
  if (packed.length === 0) return [];
  const used = await tx
    .select({
      shipmentLineId: returnLines.shipmentLineId,
      quantity:
        sql<number>`sum(CASE WHEN ${returnCases.status} IN ('issued','onHold') THEN ${returnLines.quantity}
                                      ELSE COALESCE((SELECT sum(${returnReceipts.quantity}) FROM ${returnReceipts} WHERE ${returnReceipts.lineId}=${returnLines.id}),0) END)`.mapWith(
          Number,
        ),
    })
    .from(returnLines)
    .innerJoin(returnCases, eq(returnCases.id, returnLines.caseId))
    .where(
      and(
        inArray(
          returnLines.shipmentLineId,
          packed.map(({ packed }) => packed.id),
        ),
        ignoreCaseId === undefined ? undefined : ne(returnCases.id, ignoreCaseId),
      ),
    )
    .groupBy(returnLines.shipmentLineId);
  const committed = new Map(used.map(({ shipmentLineId, quantity }) => [shipmentLineId, quantity]));
  return packed.map(({ packed, line }) => ({
    packed,
    line,
    eligible:
      packed.checked && packed.eventId !== null
        ? Math.max(0, packed.quantity - (committed.get(packed.id) ?? 0))
        : 0,
  }));
}

export async function readCaseLines(tx: Db, caseId: string) {
  return tx
    .select()
    .from(returnLines)
    .where(eq(returnLines.caseId, caseId))
    .orderBy(asc(returnLines.id));
}

export async function readCaseReceipts(tx: Db, caseId: string) {
  return tx
    .select()
    .from(returnReceipts)
    .where(eq(returnReceipts.caseId, caseId))
    .orderBy(asc(returnReceipts.createdAt), asc(returnReceipts.id));
}
