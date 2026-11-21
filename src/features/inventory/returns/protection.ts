import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { returnCases, returnLines, returnReceipts } from "./schema";

async function hasReturnsSchema(tx: Db) {
  const { rows } = await tx.execute<{ enabled: boolean }>(
    sql`SELECT to_regclass('public.inventory_return_receipts') IS NOT NULL AS enabled`,
  );
  return rows[0]?.enabled === true;
}

export async function isReturnControlledPosition(tx: Db, position: { id: string; state: string }) {
  if (position.state !== "quarantine" || !(await hasReturnsSchema(tx))) return false;
  const [receipt] = await tx
    .select({ id: returnReceipts.id })
    .from(returnReceipts)
    .where(
      and(
        eq(returnReceipts.positionId, position.id),
        inArray(returnReceipts.physical, ["quarantine", "repair"]),
      ),
    )
    .limit(1);
  return receipt !== undefined;
}

export async function hasOpenReturnAtSite(tx: Db, siteId: string) {
  if (!(await hasReturnsSchema(tx))) return false;
  const [row] = await tx
    .select({ id: returnCases.id })
    .from(returnCases)
    .where(and(eq(returnCases.siteId, siteId), inArray(returnCases.status, ["issued", "onHold"])))
    .limit(1);
  return row !== undefined;
}

export async function hasOpenReturnForPart(tx: Db, itemId: string) {
  if (!(await hasReturnsSchema(tx))) return false;
  const [line] = await tx
    .select({ id: returnLines.id })
    .from(returnLines)
    .innerJoin(returnCases, eq(returnCases.id, returnLines.caseId))
    .where(and(eq(returnLines.itemId, itemId), inArray(returnCases.status, ["issued", "onHold"])))
    .limit(1);
  return line !== undefined;
}
