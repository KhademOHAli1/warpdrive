import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { inventoryProductionBuilds, inventoryProductionOutputs } from "../production/buildSchema";
import {
  inventorySubcontractDispatches,
  inventorySubcontractReceipts,
  inventorySubcontracts,
} from "../subcontract/schema";
import type { PurchaseOrderRecord } from "./orders";
import type { purchaseOrderLines } from "./schema";
import { failPurchasing } from "./scope";

type Subcontract = typeof inventorySubcontracts.$inferSelect;
type Build = typeof inventoryProductionBuilds.$inferSelect;
type PurchaseLine = typeof purchaseOrderLines.$inferSelect;

export type LinkedPurchaseBuild = { link: Subcontract; build: Build };

/** Purchase order rows precede the affected build rows, then inventory SKU locks. */
export async function lockOrderSubcontracts(tx: Db, orderId: string) {
  const links = await tx
    .select()
    .from(inventorySubcontracts)
    .where(eq(inventorySubcontracts.orderId, orderId));
  const byBuildId = new Map(links.map((link) => [link.buildId, link]));
  const byLine = new Map<string, LinkedPurchaseBuild>();
  if (links.length === 0) return byLine;

  // Match Production's ancestor-first ordering, including when a PO has lines
  // for builds under different branches of the same production tree.
  const rows = await tx.execute<{ build_id: string }>(sql`
    WITH RECURSIVE ancestry (build_id, parent_id, path) AS (
      SELECT id, parent_id, ARRAY[id] FROM ${inventoryProductionBuilds}
      WHERE ${inArray(inventoryProductionBuilds.id, [...byBuildId.keys()])}
      UNION ALL
      SELECT child.build_id, parent.parent_id, array_prepend(parent.id, child.path)
      FROM ancestry AS child
      JOIN ${inventoryProductionBuilds} AS parent ON parent.id = child.parent_id
    )
    SELECT build_id FROM ancestry WHERE parent_id IS NULL ORDER BY path
  `);
  if (rows.rows.length !== links.length) failPurchasing("conflict");
  for (const { build_id } of rows.rows) {
    const [build] = await tx
      .select()
      .from(inventoryProductionBuilds)
      .where(eq(inventoryProductionBuilds.id, build_id))
      .for("update");
    const link = byBuildId.get(build_id);
    if (build === undefined || link === undefined) failPurchasing("conflict");
    byLine.set(link.lineId, { link, build });
  }
  return byLine;
}

export function verifyLinkedPurchaseLine(
  order: PurchaseOrderRecord,
  line: PurchaseLine,
  { link, build }: LinkedPurchaseBuild,
) {
  if (
    link.orderId !== order.id ||
    link.siteId !== order.siteId ||
    line.id !== link.lineId ||
    line.orderId !== order.id ||
    build.siteId !== order.siteId ||
    build.itemId !== line.itemId ||
    build.stockUnit !== line.stockUnit ||
    build.trackable !== line.trackable ||
    build.quantity !== line.orderedUnits
  )
    failPurchasing("stale");
}

export async function confirmSubcontractCanCancel(tx: Db, orderId: string, buildIds: string[]) {
  if (buildIds.length === 0) return;
  const [custody] = await tx
    .select({ id: inventorySubcontractDispatches.id })
    .from(inventorySubcontractDispatches)
    .where(
      and(
        inArray(inventorySubcontractDispatches.buildId, buildIds),
        sql`${inventorySubcontractDispatches.quantity} > ${inventorySubcontractDispatches.consumed} + ${inventorySubcontractDispatches.returned}`,
      ),
    )
    .limit(1);
  const [held] = await tx
    .select({ id: inventorySubcontractReceipts.outputId })
    .from(inventorySubcontractReceipts)
    .innerJoin(
      inventoryProductionOutputs,
      eq(inventoryProductionOutputs.id, inventorySubcontractReceipts.outputId),
    )
    .where(
      and(
        eq(inventorySubcontractReceipts.orderId, orderId),
        eq(inventoryProductionOutputs.status, "wip"),
      ),
    )
    .limit(1);
  if (custody !== undefined || held !== undefined) failPurchasing("conflict");
}
