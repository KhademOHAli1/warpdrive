import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import { currentInventoryActor, lockInventoryOrderDeal } from "../access";
import { lockInventoryCatalog } from "../catalog/policy";
import { isInactiveSalesDeal, readSalesOrderLines } from "../sales/orders";
import { readSalesPartAccess } from "../sales/scope";
import { inventoryCommandReceipts } from "../schema";
import { InventoryStockError } from "../stock";
import { readWarehouseAccess } from "../warehouse/access";
import {
  duplicateReturn,
  finishReturn,
  issueReturn,
  recordCommercialReturn,
  saveReturnDraft,
} from "./cases";
import { type ReturnCommand, type ReturnEffect, returnCommand } from "./contracts";
import { disposeReturn, receiveReturn } from "./custody";
import { failReturn, ReturnFailure } from "./failure";
import { type ReturnCaseRow, returnCases, returnHistory } from "./schema";
import { readReturnShipment } from "./source";

type Existing = ReturnCommand & { caseId: string };
type Draft = Extract<ReturnCommand, { type: "saveDraft" }>;

async function claimReturnCommand(tx: Db, actorId: string, command: ReturnCommand) {
  const fingerprint = createHash("sha256")
    .update("inventory-returns-v1:")
    .update(JSON.stringify(command))
    .digest("hex");
  const t = inventoryCommandReceipts;
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
  if (previous?.fingerprint !== fingerprint) failReturn("conflict");
  return false;
}

function isCustodyCommand(command: ReturnCommand) {
  return command.type === "receive" || command.type === "disposition";
}

async function requireVisibleSource(tx: Db, actor: HydratedActor, orderId: string) {
  const access = await readSalesPartAccess(tx, actor);
  const lines = await readSalesOrderLines(tx, orderId);
  if (lines.length === 0 || lines.some(({ itemId }) => !access.visible.has(itemId)))
    failReturn("unavailable");
}

async function orderSourceForCommand(
  tx: Db,
  actor: HydratedActor,
  shipmentId: string,
  command: ReturnCommand,
) {
  const source = await readReturnShipment(tx, shipmentId);
  const canEdit =
    !isCustodyCommand(command) &&
    source.order.dealId !== null &&
    (await lockInventoryOrderDeal(tx, actor, source.order.dealId));
  // Every RMA for this shipment shares a claim fence before case and stock locks.
  const locked = await readReturnShipment(tx, shipmentId, true);
  if (source.order.id !== locked.order.id || source.order.dealId !== locked.order.dealId)
    failReturn("unavailable");
  await requireVisibleSource(tx, actor, locked.order.id);
  return { ...locked, canEdit };
}

async function requireReceivingCommand(
  tx: Db,
  actor: HydratedActor,
  row: ReturnCaseRow,
  dealId: string | null,
  command: ReturnCommand,
  signal: AbortSignal,
) {
  if (!isCustodyCommand(command) && command.type !== "complete" && command.type !== "cancel")
    failReturn("unavailable");
  const warehouse = await readWarehouseAccess(tx, actor, signal);
  const site = warehouse.sites.find(({ id }) => id === row.siteId);
  if (
    site?.canManage !== true ||
    row.issuedAt === null ||
    (site.archived && command.type !== "cancel")
  )
    failReturn("unavailable");
  if (command.type === "cancel" && !(await isInactiveSalesDeal(tx, dealId)))
    failReturn("unavailable");
}

async function appendReturnHistory(tx: Db, actorId: string, id: string, command: ReturnCommand) {
  await tx.insert(returnHistory).values({
    caseId: id,
    actorId,
    type: command.type,
    reason: "reason" in command ? command.reason : null,
    createdAt: sql`clock_timestamp()`,
  });
}

async function createReturn(tx: Db, actor: HydratedActor, command: Draft) {
  if (command.version !== null) failReturn("invalid");
  const source = await orderSourceForCommand(tx, actor, command.shipmentId, command);
  if (!source.canEdit) failReturn("unavailable");
  if (await claimReturnCommand(tx, actor.id, command)) {
    const { siteId, reference, note, charges, lines } = command;
    await saveReturnDraft(
      tx,
      actor.id,
      command.requestId,
      source.shipment.id,
      source.order.id,
      { siteId, reference, note, charges, lines },
      null,
    );
    await appendReturnHistory(tx, actor.id, command.requestId, command);
  }
  return command.requestId;
}

async function changeHold(tx: Db, row: ReturnCaseRow, onHold: boolean) {
  if (row.status !== (onHold ? "issued" : "onHold")) failReturn("state");
  await tx
    .update(returnCases)
    .set({ status: onHold ? "onHold" : "issued" })
    .where(eq(returnCases.id, row.id));
}

async function applyCaseCommand(
  tx: Db,
  actorId: string,
  row: ReturnCaseRow,
  command: Existing,
  signal: AbortSignal,
) {
  switch (command.type) {
    case "saveDraft": {
      const { siteId, reference, note, charges, lines } = command;
      await saveReturnDraft(
        tx,
        actorId,
        row.id,
        row.shipmentId,
        row.orderId,
        { siteId, reference, note, charges, lines },
        row,
      );
      return;
    }
    case "issue":
      return issueReturn(tx, row);
    case "hold":
      return changeHold(tx, row, true);
    case "resume":
      return changeHold(tx, row, false);
    case "cancel":
      return finishReturn(tx, row, false);
    case "complete":
      return finishReturn(tx, row, true);
    case "duplicate":
      return duplicateReturn(tx, actorId, row, command.requestId, command.reference);
    case "receive":
      return receiveReturn(tx, actorId, row, command, signal);
    case "disposition":
      return disposeReturn(tx, actorId, row, command, signal);
    case "commercial":
      return recordCommercialReturn(tx, actorId, row, command);
  }
}

async function changeReturn(
  tx: Db,
  actor: HydratedActor,
  command: ReturnCommand,
  signal: AbortSignal,
) {
  const caseId = command.caseId;
  if (caseId === null) failReturn("invalid");
  const [hint] = await tx
    .select({ shipmentId: returnCases.shipmentId })
    .from(returnCases)
    .where(eq(returnCases.id, caseId));
  if (hint === undefined) failReturn("unavailable");
  const source = await orderSourceForCommand(tx, actor, hint.shipmentId, command);
  const [row] = await tx.select().from(returnCases).where(eq(returnCases.id, caseId)).for("update");
  if (row === undefined || row.shipmentId !== hint.shipmentId || row.orderId !== source.order.id)
    failReturn("unavailable");
  if (command.type === "saveDraft" && command.shipmentId !== row.shipmentId)
    failReturn("unavailable");
  if (!source.canEdit)
    await requireReceivingCommand(tx, actor, row, source.order.dealId, command, signal);
  const id = command.type === "duplicate" ? command.requestId : row.id;
  if (!(await claimReturnCommand(tx, actor.id, command))) return id;
  if (command.version !== row.version) failReturn("stale");
  await applyCaseCommand(tx, actor.id, row, { ...command, caseId }, signal);
  if (command.type !== "duplicate")
    await tx
      .update(returnCases)
      .set({ version: sql`${returnCases.version}+1` })
      .where(eq(returnCases.id, row.id));
  await appendReturnHistory(tx, actor.id, id, command);
  return id;
}

function returnError(error: unknown) {
  if (error instanceof ReturnFailure) return error.code;
  if (error instanceof InventoryStockError) return "stock";
  let cause = error;
  for (let depth = 0; depth < 4 && typeof cause === "object" && cause !== null; depth++) {
    if (
      "code" in cause &&
      cause.code === "23505" &&
      "constraint" in cause &&
      (cause.constraint === "inventory_return_cases_pkey" ||
        cause.constraint === "inventory_return_reference_key" ||
        cause.constraint === "inventory_return_open_position_key")
    )
      return "conflict";
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return null;
}

export async function runReturnCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<ReturnEffect> {
  const parsed = returnCommand.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const command = parsed.data;
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      await lockDirectory(tx, "read", signal);
      const actor = await currentInventoryActor(tx, who, signal);
      if (actor === null || actor.projectsGuestOnly === true) failReturn("unavailable");
      const id =
        command.type === "saveDraft" && command.caseId === null
          ? await createReturn(tx, actor, command)
          : await changeReturn(tx, actor, command, signal);
      if ((await currentInventoryActor(tx, who, signal)) === null) failReturn("unavailable");
      return { ok: true, id };
    });
  } catch (error) {
    const code = returnError(error);
    if (code === null) throw error;
    return { ok: false, error: code };
  }
}
