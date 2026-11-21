import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { applyAssetWorkspaceCommand } from "@/features/assets/registerCommands";
import { assetRegisterData, persistAssetChanges } from "@/features/assets/repository";
import { lockAssetRegister } from "@/features/assets/service";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { currentInventoryActor } from "@/features/inventory/access";
import { lockInventoryCatalog } from "@/features/inventory/catalog/policy";
import {
  InventoryStockError,
  lockInventoryStock,
  postInventoryMovement,
} from "@/features/inventory/stock";
import {
  managedWarehouseLocation,
  readWarehouseAccess,
  WarehouseFailure,
} from "@/features/inventory/warehouse/access";
import type { WarehouseSite } from "@/features/inventory/warehouse/contracts";
import {
  addOperationEvent,
  lockedItem,
  type OperationsActor,
  type Position,
  readStockPosition,
  requireUncontrolledPosition,
  type StockLocks,
  visiblePartPolicy,
  WarehouseOperationsFailure,
} from "@/features/inventory/warehouse/operations/shared";
import { inventoryStockPositions } from "@/features/inventory/warehouse/schema";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import {
  type CommissionAssetCommand,
  type CommissionAssetError,
  type CommissionAssetResult,
  commissionAssetCommand,
} from "./contracts";
import { commissioningSiteIds, eligiblePosition, matchingPosition } from "./eligibility";
import { assetCommissioningHandoffs } from "./schema";

function fail(error: CommissionAssetError): CommissionAssetResult {
  return { ok: false, error };
}

class CommissionSessionExpired extends Error {}

async function previousHandoff(tx: Db, actorId: string, requestId: string) {
  const [row] = await tx
    .select()
    .from(assetCommissioningHandoffs)
    .where(
      and(
        eq(assetCommissioningHandoffs.actorId, actorId),
        eq(assetCommissioningHandoffs.requestId, requestId),
      ),
    );
  return row;
}

async function createEquipment(
  tx: Db,
  actor: HydratedActor,
  site: WarehouseSite,
  command: CommissionAssetCommand,
) {
  const { siteId, locationId, code, name, serial, requestId, reason } = command;
  const data = await assetRegisterData(tx, [siteId], false);
  const before = { ...data, sites: [site] };
  const effect = applyAssetWorkspaceCommand(
    before,
    {
      type: "create",
      requestId,
      siteId,
      tracking: "individual",
      locationId,
      code,
      name,
      serial,
      description: null,
      modelId: null,
      categoryId: null,
      tags: [],
      fieldValues: {},
      openingQuantity: 0,
    },
    actor.name,
  );
  if (!effect.ok) return null;
  const asset = effect.value.records.find(({ id }) => id === effect.focusId);
  const created = asset?.events[0];
  if (asset === undefined || created === undefined) {
    throw new AppError(
      ERROR_IDS.DB_INVARIANT,
      "Commissioning did not produce its asset and history",
    );
  }
  const record = { ...asset, events: [{ ...created, reason }] };
  await persistAssetChanges(
    tx,
    before,
    { ...before, records: [...before.records, record] },
    actor.id,
  );
  return { assetId: record.id, assetEventId: created.id };
}

async function debitStock(
  tx: Db,
  actor: OperationsActor,
  command: CommissionAssetCommand,
  position: Position,
  locked: StockLocks,
) {
  const item = lockedItem(locked, position.itemId);
  const movementId = await postInventoryMovement(tx, item, {
    kind: "asset-commission",
    onHandDelta: -1,
    reservedDelta: 0,
    actorId: actor.id,
    requestId: command.requestId,
  });
  const debit = await tx
    .update(inventoryStockPositions)
    .set({ onHand: 0 })
    .where(
      and(
        eq(inventoryStockPositions.id, position.id),
        eq(inventoryStockPositions.onHand, 1),
        eq(inventoryStockPositions.reserved, 0),
      ),
    )
    .returning({ id: inventoryStockPositions.id });
  if (debit.length !== 1) throw new InventoryStockError("The stock position changed");
  const stockEventId = await addOperationEvent(
    tx,
    actor,
    command,
    {
      itemId: position.itemId,
      positionId: position.id,
      movementId,
      kind: "asset-commission",
      onHandDelta: -1,
      state: position.state,
    },
    {
      siteId: position.siteId,
      locationId: position.locationId,
      previousOnHand: 1,
    },
  );
  return { movementId, stockEventId };
}

async function commission(
  tx: Db,
  actor: HydratedActor,
  command: CommissionAssetCommand,
  signal: AbortSignal,
): Promise<CommissionAssetResult> {
  const access = await readWarehouseAccess(tx, actor, signal);
  const scopes = await commissioningSiteIds(tx, actor, access);
  if (!scopes.includes(command.siteId)) return fail("unavailable");
  const { site, location } = managedWarehouseLocation(access, command.locationId);
  if (site.id !== command.siteId) return fail("unavailable");

  await lockAssetRegister(tx, "write", signal);
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const previous = await previousHandoff(tx, actor.id, command.requestId);
  if (previous !== undefined) {
    return previous.fingerprint === fingerprint
      ? { ok: true, assetId: previous.assetId, handoffId: previous.id }
      : fail("conflict");
  }

  const [hint] = await tx
    .select({ itemId: inventoryStockPositions.itemId, siteId: inventoryStockPositions.siteId })
    .from(inventoryStockPositions)
    .where(eq(inventoryStockPositions.id, command.positionId));
  if (hint === undefined || !scopes.includes(hint.siteId)) return fail("unavailable");
  const locked = await lockInventoryStock(tx, [hint.itemId]);
  signal.throwIfAborted();
  const position = await readStockPosition(tx, command.positionId);
  if (!scopes.includes(position.siteId)) return fail("unavailable");
  const operator = { id: actor.id, access };
  await visiblePartPolicy(tx, operator, position.itemId);
  if (!matchingPosition(position, command)) return fail("stale");
  await requireUncontrolledPosition(tx, position);
  if (!(await eligiblePosition(tx, position, site, location))) return fail("ineligible");

  const asset = await createEquipment(tx, actor, site, command);
  if (asset === null) return fail("conflict");
  const movement = await debitStock(tx, operator, command, position, locked);
  const [handoff] = await tx
    .insert(assetCommissioningHandoffs)
    .values({
      ...asset,
      ...movement,
      positionId: position.id,
      itemId: position.itemId,
      siteId: position.siteId,
      locationId: position.locationId,
      serial: command.serial,
      lot: position.lot,
      buildOutputId: position.buildOutputId,
      actorId: actor.id,
      requestId: command.requestId,
      fingerprint,
      reason: command.reason,
    })
    .returning({ id: assetCommissioningHandoffs.id });
  if (handoff === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Commissioning handoff missing");
  return { ok: true, assetId: asset.assetId, handoffId: handoff.id };
}

export async function runCommissionAssetCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<CommissionAssetResult> {
  const parsed = commissionAssetCommand.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      await lockDirectory(tx, "read", signal);
      const actor = await currentInventoryActor(tx, who, signal);
      if (actor === null) return fail("unavailable");
      const result = await commission(tx, actor, parsed.data, signal);
      if ((await currentInventoryActor(tx, who, signal)) === null)
        throw new CommissionSessionExpired();
      return result;
    });
  } catch (error) {
    if (error instanceof CommissionSessionExpired || error instanceof WarehouseFailure)
      return fail("unavailable");
    if (error instanceof InventoryStockError) return fail("conflict");
    if (error instanceof WarehouseOperationsFailure) {
      return fail(error.code === "unavailable" ? "unavailable" : "ineligible");
    }
    throw error;
  }
}
