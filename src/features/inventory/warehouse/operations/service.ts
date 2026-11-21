import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import { currentInventoryActor } from "../../access";
import { lockInventoryCatalog } from "../../catalog/policy";
import { inventoryCommandReceipts } from "../../schema";
import { InventoryStockError } from "../../stock";
import { readWarehouseAccess, WarehouseFailure } from "../access";
import { inventoryStockEvents } from "../schema";
import {
  type WarehouseOperationsCommand,
  type WarehouseOperationsResult,
  warehouseOperationsCommand,
} from "./contracts";
import { correctStock, reverseCorrection } from "./corrections";
import { inventoryStockEventDetails } from "./schema";
import {
  failOperations,
  managedEndpoint,
  type OperationsActor,
  visiblePartPolicy,
  WarehouseOperationsFailure,
} from "./shared";
import {
  disassembleStock,
  installComponent,
  removeComponent,
  repartitionStock,
  replayStructureCommand,
} from "./structures";
import { changeTransfer, createTransfer, requireTransferReplay } from "./transfers";

async function claimOperationsReceipt(
  tx: Db,
  actorId: string,
  command: WarehouseOperationsCommand,
) {
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const [receipt] = await tx
    .insert(inventoryCommandReceipts)
    .values({ actorId, requestId: command.requestId, fingerprint })
    .onConflictDoNothing()
    .returning({ requestId: inventoryCommandReceipts.requestId });
  if (receipt !== undefined) return true;
  const [previous] = await tx
    .select({ fingerprint: inventoryCommandReceipts.fingerprint })
    .from(inventoryCommandReceipts)
    .where(
      and(
        eq(inventoryCommandReceipts.actorId, actorId),
        eq(inventoryCommandReceipts.requestId, command.requestId),
      ),
    );
  if (previous?.fingerprint !== fingerprint) failOperations("conflict");
  return false;
}

async function replayOperations(
  tx: Db,
  actor: OperationsActor,
  command: WarehouseOperationsCommand,
) {
  const { requestId } = command;
  switch (command.type) {
    case "splitStock":
    case "mergeStock":
    case "installComponent":
    case "removeComponent":
    case "disassembleStock":
      return replayStructureCommand(tx, actor, requestId);
    case "createTransfer":
    case "dispatchTransfer":
    case "receiveTransfer":
    case "cancelTransfer":
    case "correctStock":
    case "reverseCorrection":
      break;
  }
  const [recorded] = await tx
    .select({
      id: inventoryStockEvents.id,
      itemId: inventoryStockEvents.itemId,
      transferId: inventoryStockEventDetails.transferId,
      locationId: inventoryStockEventDetails.locationId,
    })
    .from(inventoryStockEvents)
    .innerJoin(
      inventoryStockEventDetails,
      eq(inventoryStockEventDetails.eventId, inventoryStockEvents.id),
    )
    .where(
      and(
        eq(inventoryStockEvents.actorId, actor.id),
        eq(inventoryStockEvents.requestId, requestId),
      ),
    )
    .limit(1);
  if (recorded === undefined || recorded.locationId === null) failOperations("conflict");
  if (recorded.transferId !== null) {
    await requireTransferReplay(tx, actor, recorded.transferId);
    return recorded.transferId;
  }
  managedEndpoint(actor, recorded.locationId, false);
  await visiblePartPolicy(tx, actor, recorded.itemId);
  return recorded.id;
}

function applyOperations(tx: Db, actor: OperationsActor, command: WarehouseOperationsCommand) {
  switch (command.type) {
    case "createTransfer":
      return createTransfer(tx, actor, command);
    case "dispatchTransfer":
    case "receiveTransfer":
    case "cancelTransfer":
      return changeTransfer(tx, actor, command);
    case "correctStock":
      return correctStock(tx, actor, command);
    case "reverseCorrection":
      return reverseCorrection(tx, actor, command);
    case "splitStock":
    case "mergeStock":
      return repartitionStock(tx, actor, command);
    case "installComponent":
      return installComponent(tx, actor, command);
    case "removeComponent":
      return removeComponent(tx, actor, command);
    case "disassembleStock":
      return disassembleStock(tx, actor, command);
  }
}

export async function runWarehouseOperationsCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<WarehouseOperationsResult> {
  const parsed = warehouseOperationsCommand.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const command = parsed.data;
  try {
    const id = await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      await lockDirectory(tx, "read", signal);
      const staff = await currentInventoryActor(tx, who, signal);
      if (staff === null) failOperations("unavailable");
      const actor = { id: staff.id, access: await readWarehouseAccess(tx, staff, signal) };
      const claimed = await claimOperationsReceipt(tx, actor.id, command);
      const result = claimed
        ? await applyOperations(tx, actor, command)
        : await replayOperations(tx, actor, command);
      if ((await currentInventoryActor(tx, who, signal)) === null) failOperations("unavailable");
      return result;
    });
    return { ok: true, value: { id } };
  } catch (error) {
    if (error instanceof WarehouseOperationsFailure) return { ok: false, error: error.code };
    if (error instanceof WarehouseFailure) return { ok: false, error: "unavailable" };
    if (error instanceof InventoryStockError) return { ok: false, error: "insufficientStock" };
    throw error;
  }
}
