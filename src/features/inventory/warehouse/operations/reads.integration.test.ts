import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { sessions, users } from "@/db/schema";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import {
  directoryLocations,
  directorySiteGrants,
  directorySites,
} from "@/features/locations/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createLegacyPartProfile } from "../../catalog/policy";
import { inventoryPartProfiles } from "../../catalog/schema";
import { inventoryItems, inventoryMovements } from "../../schema";
import {
  inventoryStockEventDetails,
  inventoryStockEvents,
  inventoryStockPositions,
  inventoryStockTransferLines,
  inventoryStockTransfers,
} from "../schema";
import type { WarehouseOperationsResult } from "./readContracts";
import { readWarehouseMovementHistory, readWarehouseTransfers } from "./reads";

const signal = () => AbortSignal.timeout(15_000);

function value<T>(result: WarehouseOperationsResult<T>): T {
  if (!result.ok) throw new Error("Warehouse operations read was denied");
  return result.value;
}

async function staff(h: TestDb, isAdmin: boolean): Promise<NativeSessionRef> {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await h.db.insert(users).values({
    id: userId,
    email: `${userId}@example.test`,
    name: "Warehouse reader",
    isAdmin,
  });
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

async function bin(h: TestDb, code: string) {
  const siteId = randomUUID();
  const locationId = randomUUID();
  await h.db.insert(directorySites).values({ id: siteId, code, name: code });
  await h.db.insert(directoryLocations).values({ id: locationId, siteId, code, name: code });
  return { siteId, locationId };
}

async function part(h: TestDb, sku: string, restricted = false) {
  const item = { id: randomUUID(), sku, name: sku, kind: "component", revision: "A" } as const;
  await h.db.insert(inventoryItems).values({ ...item, onHand: 10 });
  expect(await createLegacyPartProfile(h.db, item)).toBe(true);
  if (restricted) {
    await h.db
      .update(inventoryPartProfiles)
      .set({ visibility: "admin" })
      .where(eq(inventoryPartProfiles.itemId, item.id));
  }
  return item.id;
}

it("paginates a positioned reservation and its Unlocated remainder at exact timestamp precision", async () => {
  const h = await makeTestDb();
  try {
    const admin = await staff(h, true);
    const itemId = await part(h, "CURSOR-0132");
    const placement = await bin(h, "CURSOR-BIN");
    const positionId = randomUUID();
    await h.db.update(inventoryItems).set({ reserved: 5 }).where(eq(inventoryItems.id, itemId));
    await h.db
      .insert(inventoryStockPositions)
      .values({ id: positionId, itemId, ...placement, onHand: 3, reserved: 2 });

    const id = randomUUID();
    const createdAt = sql`'2026-01-01 00:00:00.000002+00'::timestamptz`;
    const common = {
      itemId,
      actorId: admin.userId,
      kind: "order-reserve",
      onHandDelta: 0,
      reservedDelta: 5,
    } as const;
    await h.db.insert(inventoryMovements).values([
      { ...common, id, requestId: randomUUID(), createdAt },
      {
        ...common,
        kind: "receipt",
        onHandDelta: 10,
        reservedDelta: 0,
        requestId: randomUUID(),
        createdAt: sql`'2026-01-01 00:00:00.000001+00'::timestamptz`,
      },
    ]);
    // Exact timestamp and UUID collisions are possible across the two independent ledgers.
    await h.db.insert(inventoryStockEvents).values({
      ...common,
      id,
      requestId: randomUUID(),
      createdAt,
      movementId: id,
      positionId,
      reservedDelta: 2,
    });
    const read = (cursor?: { id: string; createdAt: string; source: "event" | "movement" }) =>
      readWarehouseMovementHistory(h.db, admin, { itemId, limit: 1, cursor }, signal()).then(value);
    const first = await read();
    expect(first.rows).toMatchObject([{ id, source: "movement", siteId: null, reservedDelta: 3 }]);
    expect(first.nextCursor).toMatchObject({
      createdAt: "2026-01-01T00:00:00.000002Z",
      source: "movement",
    });
    const second = await read(first.nextCursor ?? undefined);
    expect(second.rows).toMatchObject([{ id, source: "event", ...placement, reservedDelta: 2 }]);
    const third = await read(second.nextCursor ?? undefined);
    expect(third.rows).toMatchObject([
      { kind: "receipt", onHandDelta: 10, createdAt: "2026-01-01T00:00:00.000001Z" },
    ]);
    expect(third.nextCursor).toBeNull();
  } finally {
    await h.close();
  }
});

it("keeps local history readable while hiding transfer references and notes for restricted lines", async () => {
  const h = await makeTestDb();
  try {
    const admin = await staff(h, true);
    const manager = await staff(h, false);
    const from = await bin(h, "READ-SOURCE");
    const to = await bin(h, "READ-DESTINATION");
    await h.db.insert(directorySiteGrants).values([
      { siteId: from.siteId, userId: manager.userId, role: "manager" },
      { siteId: to.siteId, userId: manager.userId, role: "manager" },
    ]);
    const itemId = await part(h, "VISIBLE-PART");
    const hiddenItemId = await part(h, "RESTRICTED-PART", true);
    const positionId = randomUUID();
    const hiddenPositionId = randomUUID();
    await h.db.insert(inventoryStockPositions).values([
      { id: positionId, itemId, ...from, onHand: 4 },
      { id: hiddenPositionId, itemId: hiddenItemId, ...from, onHand: 1 },
    ]);
    await h.db.insert(inventoryStockEvents).values({
      itemId,
      positionId,
      actorId: admin.userId,
      requestId: randomUUID(),
      kind: "reconcile",
      onHandDelta: 4,
    });

    const transferId = randomUUID();
    const lineId = randomUUID();
    const reason = "Restricted work cell";
    await h.db.insert(inventoryStockTransfers).values({
      id: transferId,
      sourceSiteId: from.siteId,
      sourceLocationId: from.locationId,
      destinationSiteId: to.siteId,
      destinationLocationId: to.locationId,
      reason,
      createdBy: admin.userId,
    });
    await h.db.insert(inventoryStockTransferLines).values([
      {
        id: lineId,
        transferId,
        itemId,
        sourcePositionId: positionId,
        quantity: 2,
        state: "available",
      },
      {
        transferId,
        itemId: hiddenItemId,
        sourcePositionId: hiddenPositionId,
        quantity: 1,
        state: "available",
      },
    ]);
    const eventId = randomUUID();
    await h.db.insert(inventoryStockEvents).values({
      id: eventId,
      itemId,
      positionId,
      actorId: admin.userId,
      requestId: randomUUID(),
      kind: "transfer-draft",
    });
    await h.db
      .insert(inventoryStockEventDetails)
      .values({ eventId, ...from, transferId, transferLineId: lineId, reason });

    const history = value(await readWarehouseMovementHistory(h.db, manager, { itemId }, signal()));
    expect(history.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "reconcile", onHandDelta: 0, affectedQuantity: 4 }),
        expect.objectContaining({
          id: eventId,
          ...from,
          transferId: null,
          transferLineId: null,
          reason: null,
        }),
      ]),
    );
    const scopedSearch = value(
      await readWarehouseMovementHistory(h.db, manager, { search: reason }, signal()),
    );
    expect(scopedSearch.rows).toEqual([]);
    const visibleToAdmin = value(
      await readWarehouseTransfers(h.db, admin, { search: reason }, signal()),
    );
    expect(visibleToAdmin.rows).toMatchObject([
      {
        id: transferId,
        reason,
        lines: expect.arrayContaining([
          expect.objectContaining({ itemId }),
          expect.objectContaining({ itemId: hiddenItemId }),
        ]),
      },
    ]);
    const visibleToManager = value(await readWarehouseTransfers(h.db, manager, {}, signal()));
    expect(visibleToManager.rows).toEqual([]);
  } finally {
    await h.close();
  }
});
