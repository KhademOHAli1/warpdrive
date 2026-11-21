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
import { readCanonicalMigrations } from "@/db/migrationAdmissionSource";
import { sessions, users } from "@/db/schema";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import {
  directoryLocations,
  directorySiteGrants,
  directorySites,
} from "@/features/locations/schema";
import { executeLocationsCommand } from "@/features/locations/service";
import { makeTestDb, type TestDb } from "@/test/db";
import { inventoryItems, inventoryMovements, inventoryOrders } from "../../schema";
import { runInventoryCommand } from "../../service";
import {
  inventoryStockAllocations,
  inventoryStockEvents,
  inventoryStockPositions,
} from "../schema";
import { runWarehouseCommand } from "../service";
import { readWarehouseMovementHistory, readWarehouseTransfers } from "./reads";
import { inventoryStockEventDetails, inventoryStockTransfers } from "./schema";
import { runWarehouseOperationsCommand } from "./service";

const signal = () => AbortSignal.timeout(20_000);

function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`Warehouse operation failed: ${result.error}`);
  return result.value;
}

async function actor(h: TestDb, name: string, isAdmin = false): Promise<NativeSessionRef> {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await h.db.insert(users).values({ id: userId, name, isAdmin, email: `${userId}@example.test` });
  await h.db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 300_000),
    authMethod: "legacy",
    assurance: "legacy",
  });
  return { userId, sessionId };
}

async function endpoint(h: TestDb, code: string, siteId = randomUUID()) {
  await h.db.insert(directorySites).values({ id: siteId, name: code, code }).onConflictDoNothing();
  const locationId = randomUUID();
  await h.db
    .insert(directoryLocations)
    .values({ id: locationId, siteId, name: `${code} bin`, code });
  return { siteId, locationId };
}

/** Insert the 0131 tables directly so a populated old schema exercises the actual 0132 backfill. */
async function seed(h: TestDb) {
  const admin = await actor(h, "Warehouse administrator", true);
  const from = await endpoint(h, "WEST");
  const to = await endpoint(h, "EAST");
  const sameSite = await endpoint(h, "WEST-SECOND", from.siteId);
  const itemId = randomUUID();
  const lotId = randomUUID();
  const serialId = randomUUID();
  const orderId = randomUUID();
  await h.db.insert(inventoryItems).values({
    id: itemId,
    sku: "QA-TRACE",
    name: "Telemetry relay",
    kind: "product",
    revision: "A",
    onHand: 19,
    reserved: 4,
  });
  await h.db.insert(inventoryOrders).values({
    id: orderId,
    itemId,
    quantity: 4,
    reserved: 4,
    buildQuantity: 0,
    status: "ready",
    createdBy: admin.userId,
  });
  const requestId = randomUUID();
  const movementId = randomUUID();
  const reservationId = randomUUID();
  await h.db.insert(inventoryMovements).values([
    {
      id: movementId,
      itemId,
      kind: "receipt",
      onHandDelta: 19,
      reservedDelta: 0,
      actorId: admin.userId,
      requestId,
    },
    {
      id: reservationId,
      itemId,
      orderId,
      kind: "order-reserve",
      onHandDelta: 0,
      reservedDelta: 4,
      actorId: admin.userId,
      requestId,
    },
  ]);
  await h.db.insert(inventoryStockPositions).values([
    {
      id: lotId,
      itemId,
      ...from,
      lot: "LOT-A40",
      onHand: 10,
      reserved: 4,
      expiryDate: "2099-12-31",
    },
    { id: serialId, itemId, ...from, lot: "LOT-A40", serial: "RELAY-0131", onHand: 1 },
  ]);
  await h.db
    .insert(inventoryStockAllocations)
    .values({ orderId, itemId, positionId: lotId, quantity: 4 });
  const serialEventId = randomUUID();
  await h.db.insert(inventoryStockEvents).values([
    {
      id: serialEventId,
      itemId,
      positionId: serialId,
      kind: "receipt",
      onHandDelta: 1,
      movementId,
      actorId: admin.userId,
      requestId,
    },
    {
      itemId,
      positionId: lotId,
      kind: "receipt",
      onHandDelta: 10,
      movementId,
      actorId: admin.userId,
      requestId,
    },
    {
      itemId,
      positionId: lotId,
      kind: "order-reserve",
      reservedDelta: 4,
      movementId: reservationId,
      orderId,
      actorId: admin.userId,
      requestId,
    },
  ]);
  return { admin, itemId, lotId, serialId, orderId, from, to, sameSite, movementId, serialEventId };
}

const command = (h: TestDb, who: NativeSessionRef, input: Record<string, unknown>) =>
  runWarehouseOperationsCommand(h.db, who, { requestId: randomUUID(), ...input }, signal());

async function originalRows(h: TestDb) {
  const [items, positions, orders, allocations, movements, events] = await Promise.all([
    h.db.select().from(inventoryItems).orderBy(asc(inventoryItems.id)),
    h.db.select().from(inventoryStockPositions).orderBy(asc(inventoryStockPositions.id)),
    h.db.select().from(inventoryOrders).orderBy(asc(inventoryOrders.id)),
    h.db
      .select()
      .from(inventoryStockAllocations)
      .orderBy(asc(inventoryStockAllocations.positionId)),
    h.db.select().from(inventoryMovements).orderBy(asc(inventoryMovements.id)),
    h.db.select().from(inventoryStockEvents).orderBy(asc(inventoryStockEvents.id)),
  ]);
  return { items, positions, orders, allocations, movements, events };
}

async function counts(h: TestDb, itemId: string) {
  const [row] = await h.db
    .select({ onHand: inventoryItems.onHand, reserved: inventoryItems.reserved })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId));
  return row;
}

it("upgrades populated 0131 lots, serials and order allocations and keeps an exact replayable ledger", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 132);
    const f = await seed(h);
    const before = await originalRows(h);
    const receipts = await ledger(h);
    expect(receipts).toHaveLength(132);
    const migrated = await applyMigrations(h.db, signal(), canonicalFolder);
    expect(migrated.ok).toBe(true);
    expect(await originalRows(h)).toEqual(before);
    const canonical = await readCanonicalMigrations(canonicalFolder, signal());
    if (!canonical.ok) throw new Error(canonical.error);
    const after = await ledger(h);
    expect(after).toHaveLength(canonical.value.length);
    expect(after[132]?.hash).toBe(
      canonical.value.find((migration) => migration.tag === "0132_inventory_warehouse_operations")
        ?.hash,
    );
    expect(after.slice(0, 132)).toEqual(receipts);
    expect(
      await h.db
        .select()
        .from(inventoryStockEventDetails)
        .where(eq(inventoryStockEventDetails.eventId, f.serialEventId)),
    ).toMatchObject([{ siteId: f.from.siteId, locationId: f.from.locationId }]);
    const history = value(
      await readWarehouseMovementHistory(h.db, f.admin, { itemId: f.itemId }, signal()),
    );
    expect(history.rows.reduce((sum, row) => sum + row.onHandDelta, 0)).toBe(19);
    expect(history.rows.reduce((sum, row) => sum + row.reservedDelta, 0)).toBe(4);
    expect(history.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: f.serialEventId,
          serial: "RELAY-0131",
          siteId: f.from.siteId,
        }),
        expect.objectContaining({
          id: f.movementId,
          source: "movement",
          siteId: null,
          onHandDelta: 8,
        }),
      ]),
    );
    const first = value(
      await readWarehouseMovementHistory(h.db, f.admin, { itemId: f.itemId, limit: 1 }, signal()),
    );
    expect(first.rows).toHaveLength(1);
    if (first.nextCursor === null) throw new Error("Expected a second history page");
    const next = value(
      await readWarehouseMovementHistory(
        h.db,
        f.admin,
        { itemId: f.itemId, limit: 1, cursor: first.nextCursor },
        signal(),
      ),
    );
    expect(next.rows[0]?.id).not.toBe(first.rows[0]?.id);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    expect(await ledger(h)).toEqual(after);
    expect(await originalRows(h)).toEqual(before);
  } finally {
    await h.close();
  }
});

it("dispatches free lot and serial units, receives partially and keeps original warehouse and order history", async () => {
  const h = await makeTestDb();
  try {
    const f = await seed(h);
    const manager = await actor(h, "Transfer manager");
    const viewer = await actor(h, "Source viewer");
    await h.db.insert(directorySiteGrants).values([
      { siteId: f.from.siteId, userId: manager.userId, role: "manager" },
      { siteId: f.from.siteId, userId: viewer.userId, role: "viewer" },
    ]);
    const draft = {
      type: "createTransfer",
      sourceLocationId: f.from.locationId,
      destinationLocationId: f.to.locationId,
      reason: "Prepare relay stock for the east workbench",
      lines: [
        { positionId: f.lotId, quantity: 5 },
        { positionId: f.serialId, quantity: 1 },
      ],
    };
    expect(await command(h, manager, draft)).toMatchObject({ ok: false, error: "unavailable" });
    await h.db
      .insert(directorySiteGrants)
      .values({ siteId: f.to.siteId, userId: manager.userId, role: "manager" });
    const { id } = value(await command(h, manager, draft));
    expect(await counts(h, f.itemId)).toEqual({ onHand: 19, reserved: 4 });
    const transfers = (who: NativeSessionRef) =>
      readWarehouseTransfers(h.db, who, {}, signal()).then(value);
    const order = async () => {
      const row = (await transfers(manager)).rows.find((row) => row.id === id);
      if (row === undefined) throw new Error("Transfer missing from manager scope");
      return row;
    };
    expect((await transfers(viewer)).rows).toEqual([]);
    const draftRow = await order();
    const dispatch = {
      type: "dispatchTransfer",
      id,
      version: draftRow.version,
      reason: "Carrier collected both lines",
      requestId: randomUUID(),
    };
    expect(value(await command(h, manager, dispatch)).id).toBe(id);
    expect(value(await command(h, manager, dispatch)).id).toBe(id);
    expect(await counts(h, f.itemId)).toEqual({ onHand: 13, reserved: 4 });
    expect(
      await command(h, manager, {
        type: "correctStock",
        positionId: f.serialId,
        locationId: f.from.locationId,
        expectedOnHand: 0,
        countedQuantity: 1,
        reason: "Found a unit in the source while the serial is in transit",
      }),
    ).toMatchObject({ ok: false });
    const directional = value(
      await readWarehouseMovementHistory(h.db, viewer, { itemId: f.itemId }, signal()),
    );
    expect(directional.rows.every((row) => row.siteId === f.from.siteId)).toBe(true);
    expect(directional.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          onHandDelta: -1,
          serial: "RELAY-0131",
          transferId: null,
          reason: null,
        }),
      ]),
    );
    expect(
      await executeLocationsCommand(
        h.db,
        f.admin,
        {
          type: "setLocationArchived",
          requestId: randomUUID(),
          id: f.to.locationId,
          archived: true,
        },
        signal(),
      ),
    ).toMatchObject({ ok: false, error: "warehouseStock" });
    expect(
      await runWarehouseCommand(
        h.db,
        f.admin,
        {
          type: "saveLocationPolicy",
          requestId: randomUUID(),
          locationId: f.to.locationId,
          kind: "structure",
        },
        signal(),
      ),
    ).toMatchObject({ ok: false, error: "conflict" });
    const active = await order();
    expect(active.status).toBe("in_transit");
    const lots = active.lines.find(({ sourcePositionId }) => sourcePositionId === f.lotId);
    const serial = active.lines.find(({ sourcePositionId }) => sourcePositionId === f.serialId);
    if (lots === undefined || serial === undefined) throw new Error("Transfer lines missing");
    value(
      await command(h, manager, {
        type: "receiveTransfer",
        id,
        version: active.version,
        reason: "First tote checked in",
        lines: [{ lineId: lots.id, quantity: 2 }],
      }),
    );
    expect(await counts(h, f.itemId)).toEqual({ onHand: 15, reserved: 4 });
    const partial = await order();
    expect(partial.status).toBe("in_transit");
    value(
      await command(h, manager, {
        type: "receiveTransfer",
        id,
        version: partial.version,
        reason: "Remaining tote and serial checked in",
        lines: [
          { lineId: lots.id, quantity: 3 },
          { lineId: serial.id, quantity: 1 },
        ],
      }),
    );
    expect((await order()).status).toBe("received");
    expect(await counts(h, f.itemId)).toEqual({ onHand: 19, reserved: 4 });
    expect(
      await h.db
        .select()
        .from(inventoryStockPositions)
        .where(eq(inventoryStockPositions.id, f.serialId)),
    ).toMatchObject([
      { locationId: f.to.locationId, lot: "LOT-A40", serial: "RELAY-0131", onHand: 1 },
    ]);
    expect(
      await h.db
        .select()
        .from(inventoryStockPositions)
        .where(eq(inventoryStockPositions.id, f.lotId)),
    ).toMatchObject([{ locationId: f.from.locationId, onHand: 5, reserved: 4 }]);
    expect(await h.db.select().from(inventoryStockAllocations)).toMatchObject([
      { orderId: f.orderId, positionId: f.lotId, quantity: 4 },
    ]);
    const serialHistory = value(
      await readWarehouseMovementHistory(h.db, f.admin, { search: "RELAY-0131" }, signal()),
    );
    expect(serialHistory.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: f.serialEventId, locationId: f.from.locationId }),
        expect.objectContaining({ onHandDelta: -1, locationId: f.from.locationId, transferId: id }),
        expect.objectContaining({ onHandDelta: 1, locationId: f.to.locationId, transferId: id }),
      ]),
    );
    const shipped = await runInventoryCommand(
      h.db,
      f.admin,
      {
        type: "ship",
        requestId: randomUUID(),
        orderId: f.orderId,
        revision: 1,
      },
      null,
      signal(),
    );
    expect(shipped.ok).toBe(true);
    expect(await counts(h, f.itemId)).toEqual({ onHand: 15, reserved: 0 });
  } finally {
    await h.close();
  }
});

it("makes reasoned cycle-count corrections and compensating reversals without rewriting history", async () => {
  const h = await makeTestDb();
  try {
    const f = await seed(h);
    const corrected = (countedQuantity: number, reason = "Cycle count discrepancy") => ({
      type: "correctStock",
      positionId: f.lotId,
      locationId: f.from.locationId,
      expectedOnHand: 10,
      countedQuantity,
      reason,
    });
    expect(await command(h, f.admin, corrected(3))).toMatchObject({ ok: false });
    expect(await command(h, f.admin, corrected(8, "    "))).toMatchObject({ ok: false });
    const intent = { ...corrected(8), requestId: randomUUID() };
    const eventId = value(await command(h, f.admin, intent)).id;
    expect(value(await command(h, f.admin, intent)).id).toBe(eventId);
    expect(await counts(h, f.itemId)).toEqual({ onHand: 17, reserved: 4 });
    expect(await command(h, f.admin, corrected(7))).toMatchObject({ ok: false });
    expect(
      await command(h, f.admin, {
        type: "reverseCorrection",
        eventId,
        expectedOnHand: 7,
        reason: "Count sheet was transcribed incorrectly",
      }),
    ).toMatchObject({ ok: false });
    const reversal = {
      type: "reverseCorrection",
      eventId,
      expectedOnHand: 8,
      reason: "Count sheet was transcribed incorrectly",
    };
    const reversed = value(await command(h, f.admin, reversal)).id;
    expect(reversed).not.toBe(eventId);
    expect(await command(h, f.admin, reversal)).toMatchObject({ ok: false });
    expect(await counts(h, f.itemId)).toEqual({ onHand: 19, reserved: 4 });
    const original = value(
      await readWarehouseMovementHistory(h.db, f.admin, { itemId: f.itemId }, signal()),
    );
    await expect(
      h.db
        .update(inventoryStockEvents)
        .set({ onHandDelta: 0 })
        .where(eq(inventoryStockEvents.id, eventId)),
    ).rejects.toThrow();
    await expect(
      h.db
        .update(inventoryStockEventDetails)
        .set({ reason: "Rewrite the historical count" })
        .where(eq(inventoryStockEventDetails.eventId, eventId)),
    ).rejects.toThrow();
    expect(original.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: eventId,
          onHandDelta: -2,
          reason: intent.reason,
          previousOnHand: 10,
        }),
        expect.objectContaining({
          id: reversed,
          onHandDelta: 2,
          reason: reversal.reason,
          reversesEventId: eventId,
        }),
      ]),
    );
    expect(await h.db.select().from(inventoryStockAllocations)).toMatchObject([
      { positionId: f.lotId, quantity: 4 },
    ]);
  } finally {
    await h.close();
  }
});

it("allows a same-site bin order, serializes competing dispatches and cancels a draft without a stock delta", async () => {
  const h = await makeTestDb();
  try {
    const f = await seed(h);
    const create = () =>
      command(h, f.admin, {
        type: "createTransfer",
        sourceLocationId: f.from.locationId,
        destinationLocationId: f.sameSite.locationId,
        reason: "Consolidate stock in the second bin",
        lines: [{ positionId: f.lotId, quantity: 5 }],
      }).then(value);
    const drafts = await Promise.all([create(), create()]);
    const orders = await h.db.select().from(inventoryStockTransfers);
    const outcomes = await Promise.all(
      drafts.map(({ id }) => {
        const row = orders.find((order) => order.id === id);
        if (row === undefined) throw new Error("Draft is missing");
        return command(h, f.admin, {
          type: "dispatchTransfer",
          id,
          version: row.version,
          reason: "Transport started",
        });
      }),
    );
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
    const remaining = (await h.db.select().from(inventoryStockTransfers)).find(
      ({ status }) => status === "draft",
    );
    if (remaining === undefined) throw new Error("Expected the unfulfilled competing draft");
    value(
      await command(h, f.admin, {
        type: "cancelTransfer",
        id: remaining.id,
        version: remaining.version,
        reason: "Transfer no longer required",
      }),
    );
    expect(await counts(h, f.itemId)).toEqual({ onHand: 14, reserved: 4 });
    expect(
      await h.db
        .select()
        .from(inventoryStockTransfers)
        .where(eq(inventoryStockTransfers.id, remaining.id)),
    ).toMatchObject([{ status: "cancelled" }]);
  } finally {
    await h.close();
  }
});
