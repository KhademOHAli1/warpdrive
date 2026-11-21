import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import { currentOperationsActor } from "@/features/operations-access/scope";
import type { HydratedActor } from "@/server/hydrateActor";
import { lockInventoryCatalog } from "../catalog/policy";
import { inventoryCommandReceipts } from "../schema";
import { SourcingFailure } from "../sourcing/scope";
import { InventoryStockError } from "../stock";
import { WarehouseFailure } from "../warehouse/access";
import {
  type PurchasingCommand,
  type PurchasingCommandResult,
  type PurchasingError,
  purchasingCommand,
} from "./contracts";
import {
  cancelPurchaseOrder,
  issuePurchaseOrder,
  lockPurchaseOrder,
  readOrderLines,
  savePurchaseDraft,
} from "./orders";
import { postPurchaseReceipt } from "./receipts";
import {
  failPurchasing,
  type PurchaseSiteAccess,
  PurchasingFailure,
  readPurchaseParts,
  readPurchaseSiteAccess,
  requirePurchaseOrganizations,
} from "./scope";

export { readPurchasingScope, readPurchasingWorkspace } from "./reads";

async function claimPurchaseCommand(tx: Db, actorId: string, command: PurchasingCommand) {
  const fingerprint = createHash("sha256")
    .update("inventory-purchasing-v1:")
    .update(JSON.stringify(command))
    .digest("hex");
  const table = inventoryCommandReceipts;
  const [inserted] = await tx
    .insert(table)
    .values({ actorId, requestId: command.requestId, fingerprint })
    .onConflictDoNothing()
    .returning({ requestId: table.requestId });
  if (inserted !== undefined) return true;
  const [previous] = await tx
    .select({ fingerprint: table.fingerprint })
    .from(table)
    .where(and(eq(table.actorId, actorId), eq(table.requestId, command.requestId)));
  if (previous?.fingerprint !== fingerprint) failPurchasing("conflict");
  return false;
}

function requireSiteCommand(
  access: PurchaseSiteAccess[],
  siteId: string,
  type: PurchasingCommand["type"],
) {
  const site = access.find(({ site }) => site.id === siteId)?.site;
  if (site === undefined || !(type === "receive" ? site.canReceive : site.canBuy)) {
    failPurchasing("unavailable");
  }
}

async function authorizeExistingOrder(
  tx: Db,
  actor: HydratedActor,
  access: PurchaseSiteAccess[],
  id: string,
  type: PurchasingCommand["type"],
) {
  const order = await lockPurchaseOrder(tx, id);
  requireSiteCommand(access, order.siteId, type);
  const lines = await readOrderLines(tx, order.id);
  const parts = await readPurchaseParts(tx, actor);
  if (!lines.every(({ itemId }) => parts.has(itemId))) failPurchasing("unavailable");
  await requirePurchaseOrganizations(tx, actor, [order.supplierOrganizationId]);
  return { order, lines };
}

async function applyPurchaseCommand(
  tx: Db,
  actor: HydratedActor,
  command: PurchasingCommand,
  signal: AbortSignal,
) {
  const access = await readPurchaseSiteAccess(tx, actor);
  if (command.type === "saveDraft" && command.id === null) {
    requireSiteCommand(access, command.siteId, command.type);
    if (await claimPurchaseCommand(tx, actor.id, command)) {
      return savePurchaseDraft(tx, actor, command, null, signal);
    }
    const previous = await authorizeExistingOrder(
      tx,
      actor,
      access,
      command.requestId,
      command.type,
    );
    return previous.order.id;
  }

  if (command.id === null) failPurchasing("invalid");
  const { order, lines } = await authorizeExistingOrder(
    tx,
    actor,
    access,
    command.id,
    command.type,
  );
  if (command.type === "saveDraft" && command.siteId !== order.siteId)
    failPurchasing("unavailable");
  if (!(await claimPurchaseCommand(tx, actor.id, command))) return order.id;

  switch (command.type) {
    case "saveDraft":
      return savePurchaseDraft(tx, actor, command, order, signal);
    case "issue":
      await issuePurchaseOrder(tx, actor, order, lines, command, signal);
      break;
    case "cancel":
      await cancelPurchaseOrder(tx, actor, order, lines, command);
      break;
    case "receive":
      await postPurchaseReceipt(tx, actor, order, command, signal);
      break;
  }
  return order.id;
}

function isReferenceConflict(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    if ("code" in current && current.code === "23505" && "constraint" in current) {
      return current.constraint === "inventory_purchase_orders_site_reference_key";
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function purchasingError(error: unknown): PurchasingError | null {
  if (error instanceof PurchasingFailure || error instanceof SourcingFailure) return error.code;
  if (error instanceof InventoryStockError) return "insufficientStock";
  if (error instanceof WarehouseFailure) {
    if (error.code === "duplicateSerial") return "conflict";
    if (error.code === "planMismatch") return "stale";
    if (error.code === "incompatibleLocation") return "unavailable";
    return error.code;
  }
  return isReferenceConflict(error) ? "conflict" : null;
}

export async function runPurchasingCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<PurchasingCommandResult> {
  const parsed = purchasingCommand.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const command = parsed.data;
  if (
    command.type === "saveDraft" &&
    (command.id === null) !== (command.expectedVersion === null)
  ) {
    return { ok: false, error: "invalid" };
  }

  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      await lockDirectory(tx, "read", signal);
      const actor = await currentOperationsActor(tx, who, signal);
      if (actor === null) failPurchasing("unavailable");
      const id = await applyPurchaseCommand(tx, actor, command, signal);
      if ((await currentOperationsActor(tx, who, signal)) === null) failPurchasing("unavailable");
      return { ok: true, id };
    });
  } catch (error) {
    const code = purchasingError(error);
    if (code === null) throw error;
    return { ok: false, error: code };
  }
}
