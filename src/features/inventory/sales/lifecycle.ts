import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { salesOrderLines, salesOrders } from "./schema";

/** Freeze native fulfillment identities while a real issued order still has demand. */
export async function hasOpenSalesDemand(
  tx: Db,
  scope: { siteId: string } | { itemIds: string[] },
) {
  if ("itemIds" in scope && scope.itemIds.length === 0) return false;
  // The same directory and catalog commands also qualify historical schema prefixes.
  const { rows } = await tx.execute<{ enabled: boolean }>(sql`
    SELECT to_regclass('public.inventory_sales_orders') IS NOT NULL AS enabled
  `);
  if (rows[0]?.enabled !== true) return false;
  const [open] = await tx
    .select({ id: salesOrders.id })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .where(
      and(
        eq(salesOrders.status, "issued"),
        sql`${salesOrderLines.shipped} < ${salesOrderLines.quantity}`,
        "siteId" in scope
          ? eq(salesOrders.siteId, scope.siteId)
          : inArray(salesOrderLines.itemId, scope.itemIds),
      ),
    )
    .limit(1);
  return open !== undefined;
}
