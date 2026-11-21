import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import { lockInventoryOrderDeal } from "../access";
import { lockInventoryCatalog } from "../catalog/policy";
import { inventoryCommandReceipts } from "../schema";
import { InventoryStockError } from "../stock";
import { readWarehouseAccess } from "../warehouse/access";
import { type SalesCommand, type SalesEffect, salesCommand } from "./contracts";
import { failSales, SalesFailure } from "./failure";
import { applySalesFulfillment } from "./fulfillment";
import {
  cancelSalesOrder,
  isInactiveSalesDeal,
  issueSalesOrder,
  readSalesOrderLines,
  saveSalesDraft,
} from "./orders";
import { type SalesLineRow, type SalesOrderRow, salesOrders } from "./schema";
import { readSalesPartAccess, requireSalesActor } from "./scope";

async function claimSalesCommand(tx: Db, actorId: string, command: SalesCommand) {
  const t = inventoryCommandReceipts;
  const fingerprint = createHash("sha256")
    .update("inventory-sales-v1:")
    .update(JSON.stringify(command))
    .digest("hex");
  const [created] = await tx
    .insert(t)
    .values({ actorId, requestId: command.requestId, fingerprint })
    .onConflictDoNothing()
    .returning({ requestId: t.requestId });
  if (created !== undefined) return true;
  const [previous] = await tx
    .select({ fingerprint: t.fingerprint })
    .from(t)
    .where(and(eq(t.actorId, actorId), eq(t.requestId, command.requestId)));
  if (previous?.fingerprint !== fingerprint) failSales("conflict");
  return false;
}

type CommercialCommand = Extract<
  SalesCommand,
  { type: "saveDraft" | "issueOrder" | "cancelOrder" | "reschedule" }
>;

function isCommercial(command: SalesCommand): command is CommercialCommand {
  return (
    command.type === "saveDraft" ||
    command.type === "issueOrder" ||
    command.type === "cancelOrder" ||
    command.type === "reschedule"
  );
}

function salesEffect(id: string, command: SalesCommand): SalesEffect {
  const shipmentId =
    command.type === "createShipment"
      ? command.requestId
      : "shipmentId" in command
        ? command.shipmentId
        : undefined;
  return shipmentId === undefined ? { ok: true, id } : { ok: true, id, shipmentId };
}

async function lockSalesOrder(
  tx: Db,
  actor: HydratedActor,
  orderId: string,
  command: SalesCommand,
) {
  const [hint] = await tx
    .select({ dealId: salesOrders.dealId })
    .from(salesOrders)
    .where(eq(salesOrders.id, orderId));
  if (hint === undefined) failSales("unavailable");
  // CRM changes lock the deal before the order. Logistics changes never take the CRM row lock.
  const canEdit =
    isCommercial(command) &&
    hint.dealId !== null &&
    (await lockInventoryOrderDeal(tx, actor, hint.dealId));
  const [order] = await tx
    .select()
    .from(salesOrders)
    .where(eq(salesOrders.id, orderId))
    .for("update");
  if (order === undefined || order.dealId !== hint.dealId) failSales("unavailable");
  if (command.type === "saveDraft" && command.dealId !== order.dealId) failSales("unavailable");
  return { order, canEdit };
}

async function requireWarehouseCommand(
  tx: Db,
  actor: HydratedActor,
  order: SalesOrderRow,
  command: SalesCommand,
  signal: AbortSignal,
) {
  const isCancellation = command.type === "cancelOrder";
  if (isCommercial(command) && !isCancellation) failSales("unavailable");
  const warehouse = await readWarehouseAccess(tx, actor, signal);
  const site = warehouse.sites.find(({ id }) => id === order.siteId);
  if (site?.canManage !== true || order.issuedAt === null || (site.archived && !isCancellation))
    failSales("unavailable");
  if (isCancellation && !(await isInactiveSalesDeal(tx, order.dealId))) failSales("unavailable");
}

async function visibleSalesLines(tx: Db, actor: HydratedActor, id: string) {
  const lines = await readSalesOrderLines(tx, id);
  const partAccess = await readSalesPartAccess(tx, actor);
  if (lines.some(({ itemId }) => !partAccess.visible.has(itemId))) failSales("unavailable");
  return lines;
}

async function applyCommercialCommand(
  tx: Db,
  actor: HydratedActor,
  order: SalesOrderRow,
  lines: SalesLineRow[],
  command: CommercialCommand,
) {
  switch (command.type) {
    case "saveDraft":
      await saveSalesDraft(tx, actor, order, command);
      break;
    case "issueOrder":
      await issueSalesOrder(tx, actor.id, order, lines);
      break;
    case "cancelOrder":
      await cancelSalesOrder(tx, actor.id, order, lines, command);
      break;
    case "reschedule":
      if (order.status !== "draft" && order.status !== "issued") failSales("state");
      await tx
        .update(salesOrders)
        .set({ dueDate: command.dueDate })
        .where(eq(salesOrders.id, order.id));
      break;
  }
}

async function changeSalesOrder(
  tx: Db,
  actor: HydratedActor,
  command: SalesCommand,
  signal: AbortSignal,
): Promise<SalesEffect> {
  if (command.type === "saveDraft" && command.orderId === null) {
    if (command.version !== null) failSales("invalid");
    if (!(await lockInventoryOrderDeal(tx, actor, command.dealId))) failSales("unavailable");
    if (await claimSalesCommand(tx, actor.id, command))
      await saveSalesDraft(tx, actor, null, command);
    else await visibleSalesLines(tx, actor, command.requestId);
    return salesEffect(command.requestId, command);
  }
  if (command.orderId === null) failSales("invalid");
  const { order, canEdit } = await lockSalesOrder(tx, actor, command.orderId, command);
  if (!canEdit) await requireWarehouseCommand(tx, actor, order, command, signal);
  const lines = await visibleSalesLines(tx, actor, order.id);
  if (!(await claimSalesCommand(tx, actor.id, command))) return salesEffect(order.id, command);
  if (command.version !== order.version) failSales("stale");
  if (isCommercial(command)) await applyCommercialCommand(tx, actor, order, lines, command);
  else await applySalesFulfillment(tx, actor.id, order, lines, command, signal);
  await tx
    .update(salesOrders)
    .set({ version: sql`${salesOrders.version} + 1` })
    .where(eq(salesOrders.id, order.id));
  return salesEffect(order.id, command);
}

function salesError(error: unknown) {
  if (error instanceof SalesFailure) return error.code;
  if (error instanceof InventoryStockError) return "stock";
  let cause = error;
  for (let depth = 0; depth < 4 && typeof cause === "object" && cause !== null; depth++) {
    if (
      "code" in cause &&
      cause.code === "23505" &&
      "constraint" in cause &&
      (cause.constraint === "inventory_sales_orders_pkey" ||
        cause.constraint === "inventory_sales_shipments_pkey" ||
        cause.constraint === "inventory_sales_packing_checks_pkey" ||
        cause.constraint === "inventory_sales_site_reference_key" ||
        cause.constraint === "inventory_sales_shipment_reference_key" ||
        cause.constraint === "inventory_sales_one_open_shipment")
    )
      return "conflict";
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return null;
}

export async function runSalesCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<SalesEffect> {
  const command = salesCommand.safeParse(raw);
  if (!command.success) return { ok: false, error: "invalid" };
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      await lockDirectory(tx, "read", signal);
      const actor = await requireSalesActor(tx, who, signal);
      const effect = await changeSalesOrder(tx, actor, command.data, signal);
      await requireSalesActor(tx, who, signal);
      return effect;
    });
  } catch (error) {
    const code = salesError(error);
    if (code === null) throw error;
    return { ok: false, error: code };
  }
}
