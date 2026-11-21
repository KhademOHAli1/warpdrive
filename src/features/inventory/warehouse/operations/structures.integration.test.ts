import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
} from "@/db/migrationAdmission.test-helpers";
import { directorySiteGrants } from "@/features/locations/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { inventoryPartProfiles } from "../../catalog/schema";
import { inventoryOrders } from "../../schema";
import { runInventoryCommand } from "../../service";
import {
  inventoryStockAllocations,
  inventoryStockEvents,
  inventoryStockPositions,
} from "../schema";
import { runWarehouseCommand } from "../service";
import { readWarehouseInstallations } from "./installationsRead";
import { readWarehouseMovementHistory } from "./reads";
import { inventoryStockEventDetails, inventoryStockInstallations } from "./schema";
import {
  actor,
  command,
  counts,
  incumbentRows,
  position,
  seedStructures,
  signal,
  value,
} from "./structures.test-helpers";

function events(h: TestDb, requestId: string) {
  return h.db
    .select({ event: inventoryStockEvents, details: inventoryStockEventDetails })
    .from(inventoryStockEvents)
    .innerJoin(
      inventoryStockEventDetails,
      eq(inventoryStockEvents.id, inventoryStockEventDetails.eventId),
    )
    .where(eq(inventoryStockEvents.requestId, requestId))
    .orderBy(asc(inventoryStockEventDetails.sequence));
}

function installations(h: TestDb, assemblyPositionId: string) {
  return h.db
    .select()
    .from(inventoryStockInstallations)
    .where(eq(inventoryStockInstallations.assemblyPositionId, assemblyPositionId))
    .orderBy(asc(inventoryStockInstallations.id));
}

it("upgrades populated 0132 stock, preserves movement history and ships an existing reservation", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 133);
    const f = await seedStructures(h);
    const receipts = await ledger(h);
    const before = await incumbentRows(h);
    expect(receipts).toHaveLength(133);

    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    const after = await ledger(h);
    expect(after).toHaveLength(134);
    expect(after.slice(0, 133)).toEqual(receipts);
    expect(await incumbentRows(h)).toEqual(before);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    expect(await ledger(h)).toEqual(after);

    const serialHistory = value(
      await readWarehouseMovementHistory(h.db, f.admin, { search: "CHILD-001" }, signal()),
    );
    expect(serialHistory.rows).toMatchObject([
      {
        id: f.child.eventId,
        kind: "receipt",
        locationId: f.source.locationId,
        serial: "CHILD-001",
        revision: "A",
      },
    ]);

    const requestId = randomUUID();
    expect(
      await runInventoryCommand(
        h.db,
        f.admin,
        { type: "ship", requestId, orderId: f.orderId, revision: 1 },
        null,
        signal(),
      ),
    ).toMatchObject({ ok: true });
    expect(await counts(h, f.lot.itemId)).toEqual({ onHand: 6, reserved: 0 });
    expect(await position(h, f.lot.positionId)).toMatchObject({
      onHand: 6,
      reserved: 0,
      lot: "MODULE-LOT-01",
    });
    expect(await h.db.select().from(inventoryStockAllocations)).toHaveLength(0);
    expect(
      await h.db.select().from(inventoryOrders).where(eq(inventoryOrders.id, f.orderId)),
    ).toMatchObject([{ status: "shipped" }]);
    expect(await events(h, requestId)).toMatchObject([
      {
        event: {
          orderId: f.orderId,
          positionId: f.lot.positionId,
          onHandDelta: -4,
          reservedDelta: -4,
        },
        details: { siteId: f.source.siteId, locationId: f.source.locationId },
      },
    ]);
  } finally {
    await h.close();
  }
});

it("splits only free bulk stock and merges only compatible positions with paired audit events", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    const split = {
      type: "splitStock",
      sourcePositionId: f.lot.positionId,
      locationId: f.source.locationId,
      quantity: 2,
      reason: "Repack counted modules",
    };
    expect(await command(h, f.admin, { ...split, quantity: 7 })).toEqual({
      ok: false,
      error: "insufficientStock",
    });
    expect(
      await command(h, f.admin, { ...split, sourcePositionId: f.child.positionId, quantity: 1 }),
    ).toEqual({ ok: false, error: "incompatibleStock" });

    const first = { ...split, requestId: randomUUID() };
    const second = { ...split, requestId: randomUUID() };
    for (const input of [first, first, second]) {
      expect(value(await command(h, f.admin, input))).toEqual({ id: input.requestId });
    }
    const firstEvents = await events(h, first.requestId);
    const secondEvents = await events(h, second.requestId);
    expect(firstEvents).toMatchObject([
      {
        event: { kind: "stock-split", positionId: f.lot.positionId, onHandDelta: -2 },
        details: { reason: split.reason, locationId: f.source.locationId },
      },
      {
        event: { kind: "stock-split", sourcePositionId: f.lot.positionId, onHandDelta: 2 },
        details: { reason: split.reason, locationId: f.source.locationId },
      },
    ]);
    const sourcePositionId = firstEvents[1]?.event.positionId;
    const destinationPositionId = secondEvents[1]?.event.positionId;
    if (sourcePositionId == null || destinationPositionId == null)
      throw new Error("Split events must identify both positions");
    expect(await position(h, sourcePositionId)).toMatchObject({
      itemId: f.lot.itemId,
      locationId: f.source.locationId,
      lot: "MODULE-LOT-01",
      expiryDate: "2099-12-31",
      onHand: 2,
      reserved: 0,
    });
    expect(await position(h, f.lot.positionId)).toMatchObject({ onHand: 6, reserved: 4 });
    expect(await command(h, f.admin, { ...split, sourcePositionId })).toEqual({
      ok: false,
      error: "incompatibleStock",
    });

    const merge = {
      type: "mergeStock",
      sourcePositionId,
      destinationPositionId,
      locationId: f.source.locationId,
      quantity: 2,
      reason: "Consolidate compatible modules",
    };
    expect(
      await command(h, f.admin, { ...merge, sourcePositionId: f.lot.positionId, quantity: 3 }),
    ).toEqual({ ok: false, error: "insufficientStock" });
    expect(
      await runWarehouseCommand(
        h.db,
        f.admin,
        {
          type: "setPositionState",
          requestId: randomUUID(),
          id: sourcePositionId,
          state: "quarantine",
          quantity: 2,
        },
        signal(),
      ),
    ).toMatchObject({ ok: true });
    expect(await command(h, f.admin, merge)).toEqual({ ok: false, error: "incompatibleStock" });
    expect(
      await runWarehouseCommand(
        h.db,
        f.admin,
        {
          type: "setPositionState",
          requestId: randomUUID(),
          id: sourcePositionId,
          state: "available",
          quantity: 2,
        },
        signal(),
      ),
    ).toMatchObject({ ok: true });
    const intent = { ...merge, requestId: randomUUID() };
    expect(value(await command(h, f.admin, intent))).toEqual({ id: intent.requestId });
    expect(value(await command(h, f.admin, intent))).toEqual({ id: intent.requestId });
    expect(await position(h, sourcePositionId)).toMatchObject({ onHand: 0, reserved: 0 });
    expect(await position(h, destinationPositionId)).toMatchObject({ onHand: 4, reserved: 0 });
    expect(await position(h, f.lot.positionId)).toMatchObject({ onHand: 6, reserved: 4 });
    expect(await counts(h, f.lot.itemId)).toEqual({ onHand: 10, reserved: 4 });
    expect(await h.db.select().from(inventoryStockAllocations)).toMatchObject([
      { orderId: f.orderId, positionId: f.lot.positionId, quantity: 4 },
    ]);

    const history = value(
      await readWarehouseMovementHistory(
        h.db,
        f.admin,
        { itemId: f.lot.itemId, kind: "stock-merge" },
        signal(),
      ),
    );
    expect(history.rows).toHaveLength(2);
    expect(history.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          positionId: sourcePositionId,
          onHandDelta: -2,
          structureOperationId: intent.requestId,
        }),
        expect.objectContaining({
          positionId: destinationPositionId,
          sourcePositionId,
          onHandDelta: 2,
          reason: merge.reason,
          revision: "A",
        }),
      ]),
    );
  } finally {
    await h.close();
  }
});

it("tracks serialized component installation and recovery while enforcing site and part access", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    const viewer = await actor(h, "Warehouse viewer");
    const remoteManager = await actor(h, "Remote manager");
    const localManager = await actor(h, "Assembly manager");
    await h.db.insert(directorySiteGrants).values([
      { siteId: f.source.siteId, userId: viewer.userId, role: "viewer" },
      { siteId: f.remote.siteId, userId: remoteManager.userId, role: "manager" },
      { siteId: f.source.siteId, userId: localManager.userId, role: "manager" },
    ]);

    const install = {
      type: "installComponent",
      assemblyPositionId: f.parent.positionId,
      componentPositionId: f.child.positionId,
      locationId: f.source.locationId,
      quantity: 1,
      reason: "Install control board",
      requestId: randomUUID(),
    };
    for (const who of [viewer, remoteManager]) {
      expect(await command(h, who, install)).toEqual({ ok: false, error: "unavailable" });
    }
    const hideChild = () =>
      h.db
        .update(inventoryPartProfiles)
        .set({ visibility: "admin" })
        .where(eq(inventoryPartProfiles.itemId, f.child.itemId));
    const showChild = () =>
      h.db
        .update(inventoryPartProfiles)
        .set({ visibility: "staff" })
        .where(eq(inventoryPartProfiles.itemId, f.child.itemId));
    await hideChild();
    expect(await command(h, localManager, install)).toEqual({ ok: false, error: "unavailable" });
    await showChild();
    expect(value(await command(h, localManager, install))).toEqual({ id: install.requestId });
    expect(value(await command(h, localManager, install))).toEqual({ id: install.requestId });

    const [active, duplicate] = await installations(h, f.parent.positionId);
    expect(active).toMatchObject({
      assemblyPositionId: f.parent.positionId,
      componentPositionId: f.child.positionId,
      quantity: 1,
      removedEventId: null,
    });
    if (active === undefined) throw new Error("Component was not installed");
    expect(duplicate).toBeUndefined();
    expect(await counts(h, f.parent.itemId)).toEqual({ onHand: 1, reserved: 0 });
    expect(await counts(h, f.child.itemId)).toEqual({ onHand: 0, reserved: 0 });
    expect(await position(h, f.child.positionId)).toMatchObject({ onHand: 0, serial: "CHILD-001" });
    expect(
      await command(h, f.admin, {
        type: "correctStock",
        positionId: f.child.positionId,
        locationId: f.source.locationId,
        expectedOnHand: 0,
        countedQuantity: 1,
        reason: "Attempt to count installed serial as free",
      }),
    ).toEqual({ ok: false, error: "conflict" });

    const query = { assemblyPositionId: f.parent.positionId };
    expect(await readWarehouseInstallations(h.db, remoteManager, query, signal())).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(value(await readWarehouseInstallations(h.db, viewer, query, signal()))).toMatchObject({
      canManage: false,
      canDisassemble: false,
      rows: [{ id: active.id, componentItemId: f.child.itemId, serial: "CHILD-001", quantity: 1 }],
    });
    expect(
      value(await readWarehouseInstallations(h.db, localManager, query, signal())),
    ).toMatchObject({
      canManage: true,
      canDisassemble: true,
    });
    await hideChild();
    expect(value(await readWarehouseInstallations(h.db, localManager, query, signal()))).toEqual({
      canManage: true,
      canDisassemble: false,
      rows: [],
    });
    expect(await command(h, localManager, install)).toEqual({ ok: false, error: "unavailable" });
    const visibleHistory = value(
      await readWarehouseMovementHistory(
        h.db,
        viewer,
        {
          kind: "component-install",
        },
        signal(),
      ),
    );
    expect(visibleHistory.rows).toMatchObject([
      {
        itemId: f.parent.itemId,
        reason: null,
        structureOperationId: null,
      },
    ]);
    await showChild();

    const remove = {
      type: "removeComponent",
      installationId: active.id,
      assemblyLocationId: f.source.locationId,
      destinationLocationId: f.recovery.locationId,
      reason: "Recover serviceable board",
      requestId: randomUUID(),
    };
    expect(value(await command(h, localManager, remove))).toEqual({ id: remove.requestId });
    expect(value(await command(h, localManager, remove))).toEqual({ id: remove.requestId });
    expect(await installations(h, f.parent.positionId)).toMatchObject([
      {
        id: active.id,
        installedEventId: active.installedEventId,
        removedEventId: expect.any(String),
        recoveredPositionId: f.child.positionId,
      },
    ]);
    expect(await position(h, f.child.positionId)).toMatchObject({
      locationId: f.recovery.locationId,
      serial: "CHILD-001",
      onHand: 1,
    });
    expect(await counts(h, f.child.itemId)).toEqual({ onHand: 1, reserved: 0 });
    const childHistory = value(
      await readWarehouseMovementHistory(
        h.db,
        f.admin,
        {
          itemId: f.child.itemId,
        },
        signal(),
      ),
    );
    expect(childHistory.rows).toHaveLength(3);
    expect(childHistory.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: f.child.eventId, locationId: f.source.locationId }),
        expect.objectContaining({
          id: active.installedEventId,
          locationId: f.source.locationId,
          onHandDelta: -1,
          kind: "component-install",
        }),
        expect.objectContaining({
          locationId: f.recovery.locationId,
          positionId: f.child.positionId,
          onHandDelta: 1,
          kind: "component-remove",
          reason: remove.reason,
        }),
      ]),
    );
  } finally {
    await h.close();
  }
});

it("disassembles atomically and restores serialized and lot components without changing a reservation", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    const manager = await actor(h, "Assembly manager");
    await h.db.insert(directorySiteGrants).values({
      siteId: f.source.siteId,
      userId: manager.userId,
      role: "manager",
    });
    const install = {
      type: "installComponent",
      assemblyPositionId: f.parent.positionId,
      locationId: f.source.locationId,
      reason: "Record tracked assembly components",
    };
    expect(
      await command(h, f.admin, {
        ...install,
        componentPositionId: f.lot.positionId,
        quantity: 7,
      }),
    ).toEqual({ ok: false, error: "insufficientStock" });
    for (const [componentPositionId, quantity] of [
      [f.child.positionId, 1],
      [f.lot.positionId, 3],
    ] as const) {
      expect(
        await command(h, f.admin, { ...install, componentPositionId, quantity }),
      ).toMatchObject({ ok: true });
    }
    expect(await counts(h, f.lot.itemId)).toEqual({ onHand: 7, reserved: 4 });
    expect(await counts(h, f.child.itemId)).toEqual({ onHand: 0, reserved: 0 });
    expect(await counts(h, f.parent.itemId)).toEqual({ onHand: 1, reserved: 0 });

    const disassemble = {
      type: "disassembleStock",
      assemblyPositionId: f.parent.positionId,
      assemblyLocationId: f.source.locationId,
      destinationLocationId: f.recovery.locationId,
      reason: "Recover all serviceable modules",
      requestId: randomUUID(),
    };
    const before = await incumbentRows(h);
    const beforeInstallations = await installations(h, f.parent.positionId);
    await h.db
      .update(inventoryPartProfiles)
      .set({ visibility: "admin" })
      .where(eq(inventoryPartProfiles.itemId, f.lot.itemId));
    expect(
      value(
        await readWarehouseInstallations(
          h.db,
          manager,
          {
            assemblyPositionId: f.parent.positionId,
          },
          signal(),
        ),
      ),
    ).toMatchObject({
      canManage: true,
      canDisassemble: false,
      rows: [{ componentItemId: f.child.itemId }],
    });
    expect(await command(h, manager, disassemble)).toEqual({ ok: false, error: "unavailable" });
    expect(
      await command(h, f.admin, { ...disassemble, destinationLocationId: f.remote.locationId }),
    ).toEqual({ ok: false, error: "incompatibleLocation" });
    expect(await incumbentRows(h)).toEqual(before);
    expect(await installations(h, f.parent.positionId)).toEqual(beforeInstallations);
    expect(await events(h, disassemble.requestId)).toHaveLength(0);

    // Simulate a divergent legacy edit. Recovery detects it after staging the parent retirement.
    const setInstalledSerialCount = (onHand: number) =>
      h.db
        .update(inventoryStockPositions)
        .set({ onHand })
        .where(eq(inventoryStockPositions.id, f.child.positionId));
    await setInstalledSerialCount(1);
    const divergent = await incumbentRows(h);
    expect(await command(h, f.admin, disassemble)).toEqual({ ok: false, error: "conflict" });
    expect(await incumbentRows(h)).toEqual(divergent);
    expect(await installations(h, f.parent.positionId)).toEqual(beforeInstallations);
    expect(await events(h, disassemble.requestId)).toHaveLength(0);
    await setInstalledSerialCount(0);

    expect(value(await command(h, f.admin, disassemble))).toEqual({ id: disassemble.requestId });
    expect(value(await command(h, f.admin, disassemble))).toEqual({ id: disassemble.requestId });
    expect(await counts(h, f.parent.itemId)).toEqual({ onHand: 0, reserved: 0 });
    expect(await counts(h, f.child.itemId)).toEqual({ onHand: 1, reserved: 0 });
    expect(await counts(h, f.lot.itemId)).toEqual({ onHand: 10, reserved: 4 });
    expect(await position(h, f.parent.positionId)).toMatchObject({
      locationId: f.source.locationId,
      serial: "PARENT-001",
      onHand: 0,
    });
    expect(await position(h, f.child.positionId)).toMatchObject({
      locationId: f.recovery.locationId,
      serial: "CHILD-001",
      onHand: 1,
    });
    expect(await position(h, f.lot.positionId)).toMatchObject({ onHand: 7, reserved: 4 });
    const recovered = await installations(h, f.parent.positionId);
    expect(recovered).toHaveLength(2);
    const returnedLot = recovered.find(
      ({ componentPositionId }) => componentPositionId === f.lot.positionId,
    );
    if (returnedLot?.recoveredPositionId == null || returnedLot.removedEventId === null) {
      throw new Error("Disassembly must identify the recovered lot and its movement");
    }
    expect(returnedLot.recoveredPositionId).not.toBe(f.lot.positionId);
    expect(await position(h, returnedLot.recoveredPositionId)).toMatchObject({
      itemId: f.lot.itemId,
      locationId: f.recovery.locationId,
      lot: "MODULE-LOT-01",
      expiryDate: "2099-12-31",
      onHand: 3,
      reserved: 0,
    });
    expect(await h.db.select().from(inventoryStockAllocations)).toMatchObject([
      { orderId: f.orderId, positionId: f.lot.positionId, quantity: 4 },
    ]);
    const stockEvents = await events(h, disassemble.requestId);
    expect(stockEvents).toHaveLength(3);
    expect(stockEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            kind: "stock-disassemble",
            positionId: f.parent.positionId,
            onHandDelta: -1,
            movementId: expect.any(String),
          }),
        }),
        expect.objectContaining({
          event: expect.objectContaining({
            id: returnedLot.removedEventId,
            kind: "component-remove",
            positionId: returnedLot.recoveredPositionId,
            sourcePositionId: f.lot.positionId,
            onHandDelta: 3,
          }),
          details: expect.objectContaining({
            locationId: f.recovery.locationId,
            reason: disassemble.reason,
          }),
        }),
      ]),
    );
    await expect(
      h.pool.query("UPDATE inventory_stock_events SET on_hand_delta = 0 WHERE id = $1", [
        returnedLot.removedEventId,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      h.pool.query("DELETE FROM inventory_stock_installations WHERE id = $1", [returnedLot.id]),
    ).rejects.toMatchObject({ code: "55000" });
    expect(await events(h, disassemble.requestId)).toEqual(stockEvents);
    expect(
      await command(h, f.admin, {
        type: "correctStock",
        positionId: f.parent.positionId,
        locationId: f.source.locationId,
        expectedOnHand: 0,
        countedQuantity: 1,
        reason: "Attempt to recount a disassembled serial",
      }),
    ).toEqual({ ok: false, error: "conflict" });
  } finally {
    await h.close();
  }
});
