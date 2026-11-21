import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
} from "@/db/migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "@/db/migrationAdmissionSource";
import { organizations } from "@/db/schema";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { inventoryPartProfiles } from "@/features/inventory/catalog/schema";
import {
  inventoryCommandReceipts,
  inventoryItems,
  inventoryMovements,
} from "@/features/inventory/schema";
import { createSourcingActor, setRole } from "@/features/inventory/sourcing/sourcing.test-helpers";
import {
  counts,
  incumbentRows,
  position,
  seedStructures,
  signal,
  command as warehouseOperation,
} from "@/features/inventory/warehouse/operations/structures.test-helpers";
import {
  inventoryStockEventDetails,
  inventoryStockEvents,
  inventoryStockLocationPolicies,
  inventoryStockPositions,
} from "@/features/inventory/warehouse/schema";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import type { AssetIntent } from "../contracts";
import { assetCommandReceipts, assetEvents, assetRecords } from "../schema";
import { readAssetsWorkspace, runAssetCommand } from "../service";
import type { CommissionAssetCommand, CommissionAssetResult } from "./contracts";
import { assetCommissioningHandoffs } from "./schema";
import { runCommissionAssetCommand } from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;
const ineligible = { ok: false, error: "ineligible" } as const;
const stale = { ok: false, error: "stale" } as const;
const assetCode = "QA-METER-0144";
const lot = "LAB-LOT-0144";

type Fixture = Awaited<ReturnType<typeof seedStructures>>;
type Success = Extract<CommissionAssetResult, { ok: true }>;

function accepted(result: CommissionAssetResult): Success {
  if (!result.ok) throw new Error(`Expected a commissioned asset, got ${result.error}`);
  return result;
}

async function seedSource(h: TestDb) {
  const fixture = await seedStructures(h);
  const { parent } = fixture;
  await h.db
    .update(inventoryPartProfiles)
    .set({
      flags: {
        assembly: true,
        component: false,
        purchasable: false,
        salable: true,
        testable: false,
        trackable: true,
      },
    })
    .where(eq(inventoryPartProfiles.itemId, parent.itemId));
  await h.db
    .update(inventoryStockPositions)
    .set({ lot })
    .where(eq(inventoryStockPositions.id, parent.positionId));
  return fixture;
}

function handoff(f: Fixture): CommissionAssetCommand {
  return {
    requestId: randomUUID(),
    positionId: f.parent.positionId,
    siteId: f.source.siteId,
    locationId: f.source.locationId,
    serial: "PARENT-001",
    lot,
    code: assetCode,
    name: "Calibrated enclosure fixture",
    reason: "Commission the serialized unit for the engineering lab.",
  };
}

function commission(
  h: TestDb,
  who: NativeSessionRef,
  input: CommissionAssetCommand,
): Promise<CommissionAssetResult> {
  return runCommissionAssetCommand(h.db, who, input, signal());
}

async function incumbentAsset(h: TestDb, f: Fixture) {
  // Insert only the asset register fields that existed in the 0143 installation.
  const id = randomUUID();
  const actorId = f.admin.userId;
  await h.db.transaction(async (tx) => {
    await tx.insert(assetRecords).values({
      id,
      siteId: f.source.siteId,
      code: "PRIOR-TOOL",
      codeKey: "prior-tool",
      name: "Incumbent torque tester",
      tracking: "individual",
      version: 1,
      serial: "TORQUE-01",
      serialKey: "torque-01",
      locationId: f.recovery.locationId,
    });
    await tx.insert(assetEvents).values({
      assetId: id,
      siteId: f.source.siteId,
      version: 1,
      kind: "created",
      actorId,
      locationId: f.recovery.locationId,
    });
    await tx.update(assetRecords).set({ version: 2 }).where(eq(assetRecords.id, id));
    await tx.insert(assetEvents).values({
      assetId: id,
      siteId: f.source.siteId,
      version: 2,
      kind: "note",
      actorId,
      reason: "Calibration completed before the upgrade",
    });
    await tx.insert(assetCommandReceipts).values({
      actorId,
      requestId: randomUUID(),
      siteId: f.source.siteId,
      fingerprint: "a".repeat(64),
      focusId: id,
    });
  });
  return id;
}

async function registerHistory(h: TestDb, assetId: string) {
  const [asset, events, receipts] = await Promise.all([
    h.db.select().from(assetRecords).where(eq(assetRecords.id, assetId)),
    h.db
      .select()
      .from(assetEvents)
      .where(eq(assetEvents.assetId, assetId))
      .orderBy(asc(assetEvents.version)),
    h.db.select().from(assetCommandReceipts).where(eq(assetCommandReceipts.focusId, assetId)),
  ]);
  return { asset, events, receipts };
}

async function locationSnapshot(h: TestDb) {
  return {
    sites: await h.db.select().from(directorySites).orderBy(asc(directorySites.id)),
    locations: await h.db.select().from(directoryLocations).orderBy(asc(directoryLocations.id)),
  };
}

async function verifyBridge(
  h: TestDb,
  f: Fixture,
  actor: NativeSessionRef,
  input: CommissionAssetCommand,
  result: Success,
) {
  const bridges = await h.db
    .select()
    .from(assetCommissioningHandoffs)
    .where(eq(assetCommissioningHandoffs.positionId, input.positionId));
  expect(bridges).toHaveLength(1);
  const [bridge] = bridges;
  assert(bridge !== undefined);
  expect(bridge).toMatchObject({
    id: result.handoffId,
    positionId: input.positionId,
    assetId: result.assetId,
    itemId: f.parent.itemId,
    siteId: input.siteId,
    locationId: input.locationId,
    serial: input.serial,
    lot: input.lot,
    buildOutputId: null,
    actorId: actor.userId,
    requestId: input.requestId,
    reason: input.reason,
  });
  const [stockRows, movementRows, details, register] = await Promise.all([
    h.db
      .select()
      .from(inventoryStockEvents)
      .where(eq(inventoryStockEvents.positionId, input.positionId)),
    h.db.select().from(inventoryMovements).where(eq(inventoryMovements.id, bridge.movementId)),
    h.db
      .select()
      .from(inventoryStockEventDetails)
      .where(eq(inventoryStockEventDetails.eventId, bridge.stockEventId)),
    registerHistory(h, result.assetId),
  ]);
  expect(stockRows.find(({ id }) => id === f.parent.eventId)).toMatchObject({ kind: "receipt" });
  expect(stockRows.filter(({ kind }) => kind === "asset-commission").map(({ id }) => id)).toEqual([
    bridge.stockEventId,
  ]);
  expect(stockRows.find(({ id }) => id === bridge.stockEventId)).toMatchObject({
    kind: "asset-commission",
    itemId: f.parent.itemId,
    positionId: input.positionId,
    movementId: bridge.movementId,
    requestId: input.requestId,
    actorId: actor.userId,
    onHandDelta: -1,
    reservedDelta: 0,
  });
  expect(movementRows).toMatchObject([
    {
      kind: "asset-commission",
      itemId: f.parent.itemId,
      requestId: input.requestId,
      actorId: actor.userId,
      onHandDelta: -1,
      reservedDelta: 0,
    },
  ]);
  expect(details).toMatchObject([
    {
      eventId: bridge.stockEventId,
      siteId: input.siteId,
      locationId: input.locationId,
      reason: input.reason,
    },
  ]);
  expect(register.asset).toMatchObject([
    {
      id: result.assetId,
      siteId: input.siteId,
      locationId: input.locationId,
      tracking: "individual",
      serial: input.serial,
      code: input.code,
      name: input.name,
      version: 1,
    },
  ]);
  expect(register.events).toMatchObject([
    {
      id: bridge.assetEventId,
      kind: "created",
      assetId: result.assetId,
      siteId: input.siteId,
      locationId: input.locationId,
      actorId: actor.userId,
    },
  ]);
  expect(await counts(h, f.parent.itemId)).toEqual({ onHand: 0, reserved: 0 });
  expect(await position(h, input.positionId)).toMatchObject({
    itemId: f.parent.itemId,
    serial: input.serial,
    lot: input.lot,
    onHand: 0,
    reserved: 0,
    locationId: input.locationId,
  });
}

it("upgrades populated stock and asset history from 0143 and links both ledgers to one commissioning", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 144);
    const f = await seedSource(h);
    const existingId = await incumbentAsset(h, f);
    const beforeStock = await incumbentRows(h);
    const beforeSites = await locationSnapshot(h);
    const beforeAsset = await registerHistory(h, existingId);
    const beforeLedger = await ledger(h);
    expect(beforeLedger).toHaveLength(144);
    expect(beforeAsset.events).toHaveLength(2);
    expect(await counts(h, f.lot.itemId)).toEqual({ onHand: 10, reserved: 4 });
    expect(await position(h, f.parent.positionId)).toMatchObject({
      lot,
      serial: "PARENT-001",
      onHand: 1,
      reserved: 0,
    });

    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    const canonical = await readCanonicalMigrations(canonicalFolder, signal());
    assert(canonical.ok);
    const upgraded = await ledger(h);
    expect(upgraded.slice(0, 144)).toEqual(beforeLedger);
    expect(upgraded).toHaveLength(canonical.value.length);
    expect(canonical.value[144]?.tag).toBe("0144_asset_commissioning");
    expect(upgraded[144]?.hash).toBe(canonical.value[144]?.hash);
    expect(await incumbentRows(h)).toEqual(beforeStock);
    expect(await locationSnapshot(h)).toEqual(beforeSites);
    expect(await registerHistory(h, existingId)).toEqual(beforeAsset);

    const input = handoff(f);
    const created = accepted(await commission(h, f.admin, input));
    await verifyBridge(h, f, f.admin, input, created);
    expect(await commission(h, f.admin, input)).toEqual(created);
    expect(
      await commission(h, f.admin, { ...input, reason: "Different reason with the same request" }),
    ).toEqual({ ok: false, error: "conflict" });

    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    expect(await ledger(h)).toEqual(upgraded);
    expect(await locationSnapshot(h)).toEqual(beforeSites);
    expect(await registerHistory(h, existingId)).toEqual(beforeAsset);
    expect(await counts(h, f.lot.itemId)).toEqual({ onHand: 10, reserved: 4 });
    await verifyBridge(h, f, f.admin, input, created);
  } finally {
    await h.close();
  }
});

it("rolls back both ledgers after a bridge insert failure and safely retries the request", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedSource(h);
    const existingId = await incumbentAsset(h, f);
    const input = handoff(f);
    const beforeStock = await incumbentRows(h);
    const beforePosition = await position(h, input.positionId);
    const beforeAsset = await registerHistory(h, existingId);

    await h.db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE FUNCTION test_reject_commissioning_handoff() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM asset_events WHERE id = NEW.asset_event_id)
             OR NOT EXISTS (SELECT 1 FROM inventory_stock_events WHERE id = NEW.stock_event_id)
             OR NOT EXISTS (SELECT 1 FROM inventory_movements WHERE id = NEW.movement_id)
             OR NOT EXISTS (
               SELECT 1 FROM inventory_stock_positions
               WHERE id = NEW.position_id AND on_hand = 0
             ) THEN
            RAISE EXCEPTION 'Commissioning reached the bridge before both ledger writes';
          END IF;
          RAISE EXCEPTION 'Test rejected commissioning bridge insert' USING ERRCODE = '23514';
        END;
        $$;
      `);
      await tx.execute(sql`
        CREATE TRIGGER test_reject_commissioning_handoff
        BEFORE INSERT ON asset_commissioning_handoffs
        FOR EACH ROW EXECUTE FUNCTION test_reject_commissioning_handoff()
      `);
    });
    try {
      await expect(commission(h, f.admin, input)).rejects.toMatchObject({
        cause: { code: "23514", message: "Test rejected commissioning bridge insert" },
      });
    } finally {
      await h.db.transaction(async (tx) => {
        await tx.execute(
          sql`DROP TRIGGER test_reject_commissioning_handoff ON asset_commissioning_handoffs`,
        );
        await tx.execute(sql`DROP FUNCTION test_reject_commissioning_handoff()`);
      });
    }

    expect(await incumbentRows(h)).toEqual(beforeStock);
    expect(await position(h, input.positionId)).toEqual(beforePosition);
    expect(await registerHistory(h, existingId)).toEqual(beforeAsset);
    expect(await h.db.select({ id: assetRecords.id }).from(assetRecords)).toEqual([
      { id: existingId },
    ]);
    expect(await h.db.select().from(assetEvents).orderBy(asc(assetEvents.version))).toEqual(
      beforeAsset.events,
    );
    expect(await h.db.select().from(assetCommissioningHandoffs)).toEqual([]);
    expect(
      await h.db
        .select()
        .from(inventoryCommandReceipts)
        .where(eq(inventoryCommandReceipts.requestId, input.requestId)),
    ).toEqual([]);

    const created = accepted(await commission(h, f.admin, input));
    await verifyBridge(h, f, f.admin, input, created);
  } finally {
    await h.close();
  }
});

async function ineligibleStock(
  h: TestDb,
  f: Fixture,
  actor: NativeSessionRef,
  input: CommissionAssetCommand,
) {
  const row = () => eq(inventoryStockPositions.id, input.positionId);
  await h.db.update(inventoryStockPositions).set({ state: "hold" }).where(row());
  expect(await commission(h, actor, input)).toEqual(ineligible);
  await h.db.update(inventoryStockPositions).set({ state: "quarantine" }).where(row());
  expect(await commission(h, actor, input)).toEqual(ineligible);
  await h.db.update(inventoryStockPositions).set({ state: "available", reserved: 1 }).where(row());
  await h.db
    .update(inventoryItems)
    .set({ reserved: 1 })
    .where(eq(inventoryItems.id, f.parent.itemId));
  expect(await commission(h, actor, input)).toEqual(ineligible);
  await h.db.update(inventoryStockPositions).set({ onHand: 0, reserved: 0 }).where(row());
  await h.db
    .update(inventoryItems)
    .set({ onHand: 0, reserved: 0 })
    .where(eq(inventoryItems.id, f.parent.itemId));
  expect(await commission(h, actor, input)).toEqual(ineligible);
  await h.db.update(inventoryStockPositions).set({ onHand: 1 }).where(row());
  await h.db
    .update(inventoryItems)
    .set({ onHand: 1 })
    .where(eq(inventoryItems.id, f.parent.itemId));

  const ownerId = randomUUID();
  await h.db.insert(organizations).values({
    id: ownerId,
    ownerId: f.admin.userId,
    name: "Customer-owned equipment",
    visibilityLevel: "all",
  });
  await h.db.update(inventoryStockPositions).set({ ownerOrganizationId: ownerId }).where(row());
  expect(await commission(h, actor, input)).toEqual(ineligible);
  await h.db.update(inventoryStockPositions).set({ ownerOrganizationId: null }).where(row());
  await h.db.insert(inventoryStockLocationPolicies).values({
    siteId: input.siteId,
    locationId: input.locationId,
    kind: "external",
  });
  expect(await commission(h, actor, input)).toEqual(ineligible);
  await h.db
    .delete(inventoryStockLocationPolicies)
    .where(eq(inventoryStockLocationPolicies.locationId, input.locationId));
  await h.db.update(inventoryStockPositions).set({ expiryDate: "2020-01-01" }).where(row());
  expect(await commission(h, actor, input)).toEqual(ineligible);
  await h.db.update(inventoryStockPositions).set({ expiryDate: null }).where(row());

  const transfer = await warehouseOperation(h, actor, {
    type: "createTransfer",
    sourceLocationId: f.source.locationId,
    destinationLocationId: f.recovery.locationId,
    lines: [{ positionId: input.positionId, quantity: 1 }],
    reason: "Plan a move before commissioning",
  });
  assert(transfer.ok);
  expect(await commission(h, actor, input)).toEqual(ineligible);
  expect(
    await warehouseOperation(h, actor, {
      type: "cancelTransfer",
      id: transfer.value.id,
      version: 1,
      reason: "Release the serial from the pending move",
    }),
  ).toMatchObject({ ok: true });
}

async function refuseResurrection(
  h: TestDb,
  actor: NativeSessionRef,
  input: CommissionAssetCommand,
  created: Success,
) {
  expect(
    await warehouseOperation(h, actor, {
      type: "correctStock",
      positionId: input.positionId,
      locationId: input.locationId,
      expectedOnHand: 0,
      countedQuantity: 1,
      reason: "Generic count cannot restore the transferred serial",
    }),
  ).toEqual({ ok: false, error: "incompatibleStock" });
  const workspace = await readAssetsWorkspace(h.db, actor, signal());
  assert(workspace.ok);
  const equipment = workspace.value.records.find(({ id }) => id === created.assetId);
  assert(equipment?.tracking === "individual");
  const edit: Extract<AssetIntent, { type: "update" }> = {
    type: "update",
    assetId: equipment.id,
    version: equipment.version,
    code: equipment.code,
    name: equipment.name,
    description: equipment.description,
    modelId: equipment.modelId,
    categoryId: equipment.categoryId,
    tags: equipment.tags,
    fieldValues: equipment.fieldValues,
    serial: "REWRITTEN-0144",
  };
  expect(
    await runAssetCommand(h.db, actor, { ...edit, requestId: randomUUID() }, signal()),
  ).toEqual({ ok: false, error: "state" });
  await expect(registerHistory(h, equipment.id)).resolves.toMatchObject({
    asset: [{ id: equipment.id, serial: input.serial, version: equipment.version }],
    events: [{ kind: "created" }],
  });
}

it("requires both site grants, rejects ineligible and stale stock, and serializes competing handoffs", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedSource(h);
    const { admin, source, remote } = f;
    const warehouseOnly = await createSourcingActor(
      h,
      admin,
      "Warehouse only",
      source.siteId,
      "warehouse_manager",
    );
    const assetsOnly = await createSourcingActor(
      h,
      admin,
      "Equipment only",
      source.siteId,
      "asset_manager",
    );
    await setRole(h, admin, assetsOnly, remote.siteId, "warehouse_manager");
    const both = await createSourcingActor(
      h,
      admin,
      "Commissioning operator",
      source.siteId,
      "warehouse_manager",
      "asset_manager",
    );
    const input = handoff(f);
    for (const denied of [warehouseOnly, assetsOnly]) {
      expect(await commission(h, denied, input)).toEqual(unavailable);
    }
    expect(
      await commission(h, both, { ...input, siteId: remote.siteId, locationId: remote.locationId }),
    ).toEqual(unavailable);
    expect(await commission(h, both, { ...input, lot: lot.toLowerCase() })).toEqual(stale);
    expect(await commission(h, both, { ...input, serial: input.serial.toLowerCase() })).toEqual(
      stale,
    );
    expect(await commission(h, both, { ...input, locationId: f.recovery.locationId })).toEqual(
      stale,
    );
    expect(
      await commission(h, both, {
        ...input,
        positionId: f.lot.positionId,
        lot: "MODULE-LOT-01",
      }),
    ).toEqual(stale);
    await ineligibleStock(h, f, both, input);
    expect(await h.db.select().from(assetCommissioningHandoffs)).toEqual([]);
    expect(await counts(h, f.parent.itemId)).toEqual({ onHand: 1, reserved: 0 });

    const competing = { ...input, requestId: randomUUID(), code: "QA-OTHER-METER" };
    const [first, second] = await Promise.all([
      commission(h, both, input),
      commission(h, both, competing),
    ]);
    expect([first, second].filter(({ ok }) => ok)).toHaveLength(1);
    const winner = first.ok ? input : competing;
    const created = accepted(first.ok ? first : second);
    expect([first, second].find(({ ok }) => !ok)).toMatchObject({ ok: false });
    await verifyBridge(h, f, both, winner, created);
    expect(await commission(h, both, winner)).toEqual(created);
    await refuseResurrection(h, both, winner, created);
    expect(
      await h.db
        .select()
        .from(assetRecords)
        .where(inArray(assetRecords.code, [input.code, competing.code])),
    ).toHaveLength(1);
    expect(await counts(h, f.parent.itemId)).toEqual({ onHand: 0, reserved: 0 });

    await setRole(h, admin, both, source.siteId, "asset_manager", false);
    expect(await commission(h, both, winner)).toEqual(unavailable);
    await verifyBridge(h, f, both, winner, created);
  } finally {
    await h.close();
  }
});
