import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { commissioningSiteIds } from "@/features/assets/commissioning/eligibility";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import { currentInventoryActor } from "../access";
import { lockInventoryCatalog } from "../catalog/policy";
import { inventoryCommandReceipts } from "../schema";
import { failWarehouse, readWarehouseAccess, WarehouseFailure } from "./access";
import { applyWarehouseCommand, resolveWarehouseTarget } from "./changes";
import {
  type WarehouseCommand,
  type WarehouseQuery,
  type WarehouseResult,
  warehouseCommand,
} from "./contracts";
import { projectWarehouse } from "./reads";
import { inventoryStockEvents } from "./schema";

export function readWarehouseWorkspace(
  db: Db,
  who: NativeSessionRef,
  query: WarehouseQuery,
  signal: AbortSignal,
): Promise<WarehouseResult> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockInventoryCatalog(tx, signal);
    await lockDirectory(tx, "read", signal);
    const actor = await currentInventoryActor(tx, who, signal);
    if (actor === null) return { ok: false, error: "unavailable" };
    const access = await readWarehouseAccess(tx, actor, signal);
    const value = await projectWarehouse(tx, access, query);
    const commissionableSites = await commissioningSiteIds(tx, actor, access);
    if ((await currentInventoryActor(tx, who, signal)) === null) {
      return { ok: false, error: "unavailable" };
    }
    return { ok: true, value: { ...value, commissioningSiteIds: commissionableSites } };
  });
}

async function claimWarehouseReceipt(tx: Db, actorId: string, command: WarehouseCommand) {
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
  if (previous?.fingerprint !== fingerprint) failWarehouse("conflict");
  return false;
}

async function warehouseReplayFocus(
  tx: Db,
  actorId: string,
  command: WarehouseCommand,
): Promise<string> {
  if (command.type === "saveLocationPolicy") return command.locationId;
  const [event] = await tx
    .select({
      position: inventoryStockEvents.positionId,
      incoming: inventoryStockEvents.incomingId,
    })
    .from(inventoryStockEvents)
    .where(
      and(
        eq(inventoryStockEvents.actorId, actorId),
        eq(inventoryStockEvents.requestId, command.requestId),
      ),
    );
  const focus = event?.position ?? event?.incoming;
  if (focus != null) return focus;
  if (command.type === "cancelIncoming" || command.type === "setPositionState") return command.id;
  failWarehouse("conflict");
}

export async function runWarehouseCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<WarehouseResult> {
  const parsed = warehouseCommand.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const command = parsed.data;
  let effect: { focusId: string; siteId: string; itemId: string | null };
  try {
    effect = await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      // Policy edits serialize with receipts and reservations into this directory.
      await lockDirectory(tx, command.type === "saveLocationPolicy" ? "write" : "read", signal);
      const actor = await currentInventoryActor(tx, who, signal);
      if (actor === null) failWarehouse("unavailable");
      const access = await readWarehouseAccess(tx, actor, signal);
      const target = await resolveWarehouseTarget(tx, access, command);
      const claimed = await claimWarehouseReceipt(tx, actor.id, command);
      const focusId = claimed
        ? await applyWarehouseCommand(tx, access, target, actor.id, command)
        : await warehouseReplayFocus(tx, actor.id, command);
      if ((await currentInventoryActor(tx, who, signal)) === null) failWarehouse("unavailable");
      return { focusId, siteId: target.site.id, itemId: target.itemId };
    });
  } catch (error) {
    if (error instanceof WarehouseFailure) return { ok: false, error: error.code };
    throw error;
  }

  // Read only after the mutation releases its SKU locks. A scope change after commit
  // leaves an unconfirmed transport result so the caller retains its retry request ID.
  const refreshed = await readWarehouseWorkspace(db, who, {}, signal);
  if (!refreshed.ok || !refreshed.value.sites.some(({ id }) => id === effect.siteId)) {
    failWarehouse("unavailable");
  }
  if (effect.itemId !== null && !refreshed.value.parts.some(({ id }) => id === effect.itemId)) {
    failWarehouse("unavailable");
  }
  return { ...refreshed, focusId: effect.focusId };
}
