import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  type InventoryStockKind,
  inventoryItems,
  inventoryMovements,
  inventoryStockLimit,
} from "./schema";

export type { InventoryStockKind } from "./schema";

type StockRow = typeof inventoryItems.$inferSelect;

export class InventoryStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryStockError";
  }
}

export async function lockInventoryStock(tx: Db, ids: string[]): Promise<Map<string, StockRow>> {
  if (ids.length === 0) return new Map();
  const items = await tx
    .select()
    .from(inventoryItems)
    .where(inArray(inventoryItems.id, Array.from(new Set(ids))))
    .orderBy(asc(inventoryItems.id))
    .for("update");
  return new Map(items.map((item) => [item.id, item]));
}

interface InventoryMovement {
  actorId: string;
  requestId: string;
  orderId?: string;
  kind: InventoryStockKind;
  onHandDelta: number;
  reservedDelta: number;
}

/** Post a balance change and its ledger entry in the same stock-locking transaction. */
export async function postInventoryMovement(
  tx: Db,
  item: StockRow,
  { actorId, requestId, orderId, kind, onHandDelta, reservedDelta }: InventoryMovement,
): Promise<void> {
  const onHand = item.onHand + onHandDelta;
  const reserved = item.reserved + reservedDelta;
  if (
    !Number.isSafeInteger(onHandDelta) ||
    !Number.isSafeInteger(reservedDelta) ||
    onHand > inventoryStockLimit ||
    reserved < 0 ||
    reserved > onHand
  ) {
    throw new InventoryStockError(
      "This movement would exceed the available stock or balance limit.",
    );
  }

  const [updated] = await tx
    .update(inventoryItems)
    .set({ onHand, reserved })
    .where(
      and(
        eq(inventoryItems.id, item.id),
        eq(inventoryItems.onHand, item.onHand),
        eq(inventoryItems.reserved, item.reserved),
      ),
    )
    .returning({ id: inventoryItems.id });
  if (updated === undefined)
    throw new InventoryStockError("The stock balance changed. Refresh and try again.");

  await tx.insert(inventoryMovements).values({
    itemId: item.id,
    actorId,
    requestId,
    orderId: orderId ?? null,
    kind,
    onHandDelta,
    reservedDelta,
  });
  item.onHand = onHand;
  item.reserved = reserved;
}
