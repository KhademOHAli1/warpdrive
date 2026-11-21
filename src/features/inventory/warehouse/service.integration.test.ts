import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
  migrationFolder,
} from "@/db/migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "@/db/migrationAdmissionSource";
import { deals, organizations, pipelines, sessions, stages, users } from "@/db/schema";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import {
  directoryLocations,
  directorySiteGrants,
  directorySites,
} from "@/features/locations/schema";
import { executeLocationsCommand } from "@/features/locations/service";
import { makeTestDb, type TestDb } from "@/test/db";
import type { Result } from "@/types/result";
import { blankCatalogProfile } from "../catalog/contracts";
import { inventoryPartFamilies, inventoryPartProfiles } from "../catalog/schema";
import type { InventoryCommand, InventoryOrder } from "../contracts";
import { readInventoryWorkspace } from "../reads";
import {
  inventoryCommandReceipts,
  inventoryItems,
  inventoryMovements,
  inventoryOrders,
} from "../schema";
import { runInventoryCommand } from "../service";
import type { WarehouseCommand, WarehouseResult, WarehouseWorkspace } from "./contracts";
import { inventoryStockAllocations, inventoryStockEvents, inventoryStockPositions } from "./schema";
import { readWarehouseWorkspace, runWarehouseCommand } from "./service";

const signal = () => AbortSignal.timeout(15_000);
const nearDate = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

function value<T, E>(result: Result<T, E>): T {
  if (!result.ok)
    throw new Error(`Expected successful stock operation, got ${String(result.error)}`);
  return result.value;
}

function focus(result: WarehouseResult): string {
  if (result.ok && result.focusId !== undefined) return result.focusId;
  throw new Error("Stock operation did not return a record ID");
}

async function staff(h: TestDb, admin = false): Promise<NativeSessionRef> {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await h.db.insert(users).values({
    id: userId,
    email: `${userId}@example.test`,
    name: "Stock operator",
    isAdmin: admin,
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

async function activeSite(h: TestDb, code: string) {
  const id = randomUUID();
  await h.db.insert(directorySites).values({ id, code, name: code });
  return id;
}

async function activeBin(h: TestDb, siteId: string, code: string, parentId: string | null = null) {
  const id = randomUUID();
  await h.db.insert(directoryLocations).values({ id, siteId, code, name: code, parentId });
  return id;
}

async function part(
  h: TestDb,
  sku: string,
  opts: { onHand?: number; reserved?: number; revision?: string; familyId?: string } = {},
) {
  const id = randomUUID();
  const { revision = "A", onHand = 0, reserved = 0 } = opts;
  await h.db
    .insert(inventoryItems)
    .values({ id, sku, name: sku, kind: "product", revision, onHand, reserved });
  if (opts.familyId === undefined)
    await h.db.insert(inventoryPartFamilies).values({ id, code: sku });
  await h.db.insert(inventoryPartProfiles).values({
    itemId: id,
    familyId: opts.familyId ?? id,
    revisionKey: revision,
    flags: blankCatalogProfile("product").flags,
  });
  return id;
}

async function salesDeal(h: TestDb, actor: NativeSessionRef) {
  const pipelineId = randomUUID();
  const stageId = randomUUID();
  const id = randomUUID();
  await h.db.insert(pipelines).values({ id: pipelineId, name: "Manufacturing sales" });
  await h.db.insert(stages).values({ id: stageId, pipelineId, name: "Confirmed" });
  await h.db.insert(deals).values({
    id,
    pipelineId,
    stageId,
    title: "Stocked item order",
    ownerId: actor.userId,
    visibilityLevel: "all",
  });
  return id;
}

type Receive = Extract<WarehouseCommand, { type: "receive" }>;
function receive(
  itemId: string,
  locationId: string,
  quantity: number,
  overrides: Partial<Receive> = {},
): Receive {
  return {
    type: "receive",
    requestId: randomUUID(),
    itemId,
    locationId,
    quantity,
    lot: null,
    serial: null,
    expiryDate: null,
    state: "available",
    ownerOrganizationId: null,
    incomingId: null,
    ...overrides,
  };
}

function runWarehouse(h: TestDb, actor: NativeSessionRef, command: WarehouseCommand) {
  return runWarehouseCommand(h.db, actor, command, signal());
}

function warehouse(
  h: TestDb,
  actor: NativeSessionRef,
  query: Parameters<typeof readWarehouseWorkspace>[2] = {},
) {
  return readWarehouseWorkspace(h.db, actor, query, signal());
}

function at(workspace: WarehouseWorkspace, itemId: string, locationId: string | null) {
  return workspace.balances.find(
    (entry) => entry.itemId === itemId && entry.locationId === locationId,
  );
}

async function nativeOrder(
  h: TestDb,
  actor: NativeSessionRef,
  dealId: string,
  itemId: string,
  quantity: number,
) {
  const response = value(
    await runInventoryCommand(
      h.db,
      actor,
      {
        type: "place",
        requestId: randomUUID(),
        dealId,
        itemId,
        quantity,
      },
      dealId,
      signal(),
    ),
  );
  const order = response.orders.find((row) => row.itemId === itemId && row.status === "ready");
  if (order === undefined) throw new Error("Inventory order was not returned");
  return order;
}

function finish(
  h: TestDb,
  actor: NativeSessionRef,
  order: InventoryOrder,
  type: "ship" | "cancel",
) {
  return runInventoryCommand(
    h.db,
    actor,
    {
      type,
      requestId: randomUUID(),
      orderId: order.id,
      revision: order.revision,
    },
    order.dealId,
    signal(),
  );
}

async function itemCounts(h: TestDb, itemId: string) {
  const [row] = await h.db
    .select({ onHand: inventoryItems.onHand, reserved: inventoryItems.reserved })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId));
  return row;
}

async function orderTrace(
  h: TestDb,
  orderId: string,
  kind: "order-reserve" | "shipment" | "cancel-release",
) {
  return h.db
    .select({
      id: inventoryStockEvents.positionId,
      onHand: inventoryStockEvents.onHandDelta,
      reserved: inventoryStockEvents.reservedDelta,
      movementId: inventoryStockEvents.movementId,
    })
    .from(inventoryStockEvents)
    .where(and(eq(inventoryStockEvents.orderId, orderId), eq(inventoryStockEvents.kind, kind)));
}

describe("warehouse stock with active native sessions", () => {
  let h: TestDb;
  let admin: NativeSessionRef;
  let site: string;
  let bin: string;
  let itemId: string;

  beforeEach(async () => {
    h = await makeTestDb();
    admin = await staff(h, true);
    site = await activeSite(h, "MAIN");
    bin = await activeBin(h, site, "A1");
    itemId = await part(h, "DIN-WAREHOUSE");
  });

  afterEach(async () => {
    await h?.close();
  });

  it("allocates eligible positions FEFO and traces the exact shipment and cancellation", async () => {
    const external = await activeBin(h, site, "OUTSIDE");
    const [company] = await h.db
      .insert(organizations)
      .values({
        name: "Customer stock",
        ownerId: admin.userId,
        visibilityLevel: "owner",
      })
      .returning({ id: organizations.id });
    if (company === undefined) throw new Error("Customer stock fixture missing");
    value(
      await runWarehouse(h, admin, {
        type: "saveLocationPolicy",
        requestId: randomUUID(),
        locationId: external,
        kind: "external",
      }),
    );
    const later = focus(
      await runWarehouse(
        h,
        admin,
        receive(itemId, bin, 5, { lot: "LOT-LATER", expiryDate: nearDate(75) }),
      ),
    );
    const earlier = focus(
      await runWarehouse(
        h,
        admin,
        receive(itemId, bin, 3, { lot: "lot-first", expiryDate: nearDate(30) }),
      ),
    );
    for (const receipt of [
      receive(itemId, bin, 4, { lot: "LOT-EXPIRED", expiryDate: nearDate(-1) }),
      receive(itemId, bin, 2, { lot: "LOT-HOLD", state: "hold" }),
      receive(itemId, bin, 6, { lot: "LOT-CUSTOMER", ownerOrganizationId: company.id }),
      receive(itemId, external, 2, { lot: "LOT-EXTERNAL" }),
    ])
      value(await runWarehouse(h, admin, receipt));
    expect(await itemCounts(h, itemId)).toEqual({ onHand: 22, reserved: 0 });
    const stock = value(await warehouse(h, admin, { itemId }));
    expect(at(stock, itemId, bin)).toMatchObject({ available: 8, onHand: 20 });
    expect(at(stock, itemId, external)).toMatchObject({ available: 0, onHand: 2 });

    const dealId = await salesDeal(h, admin);
    const tooMany: InventoryCommand = {
      type: "place",
      requestId: randomUUID(),
      dealId,
      itemId,
      quantity: 9,
    };
    expect(await runInventoryCommand(h.db, admin, tooMany, dealId, signal())).toMatchObject({
      ok: false,
    });
    expect(await itemCounts(h, itemId)).toEqual({ onHand: 22, reserved: 0 });
    const order = await nativeOrder(h, admin, dealId, itemId, 4);
    expect(await orderTrace(h, order.id, "order-reserve")).toEqual(
      expect.arrayContaining([
        { id: earlier, onHand: 0, reserved: 3, movementId: expect.any(String) },
        { id: later, onHand: 0, reserved: 1, movementId: expect.any(String) },
      ]),
    );
    value(await finish(h, admin, order, "ship"));
    expect(await orderTrace(h, order.id, "shipment")).toEqual(
      expect.arrayContaining([
        { id: earlier, onHand: -3, reserved: -3, movementId: expect.any(String) },
        { id: later, onHand: -1, reserved: -1, movementId: expect.any(String) },
      ]),
    );
    expect(await itemCounts(h, itemId)).toEqual({ onHand: 18, reserved: 0 });
    const next = await nativeOrder(h, admin, dealId, itemId, 2);
    value(await finish(h, admin, next, "cancel"));
    expect(await orderTrace(h, next.id, "cancel-release")).toMatchObject([
      { id: later, onHand: 0, reserved: -2 },
    ]);
    expect((await h.db.select().from(inventoryStockAllocations)).length).toBe(0);
    expect(at(value(await warehouse(h, admin, { itemId })), itemId, bin)).toMatchObject({
      onHand: 16,
      reserved: 0,
      available: 4,
    });
  });

  it("filters site and owner data and keeps partial quarantine and revoked retries correct", async () => {
    const viewer = await staff(h);
    const manager = await staff(h);
    const other = await activeSite(h, "HIDDEN");
    const hiddenBin = await activeBin(h, other, "SECRET");
    const [company] = await h.db
      .insert(organizations)
      .values({
        name: "Restricted owner",
        ownerId: admin.userId,
        visibilityLevel: "owner",
      })
      .returning({ id: organizations.id });
    if (company === undefined) throw new Error("Owner policy fixture missing");
    await h.db.insert(directorySiteGrants).values([
      { siteId: site, userId: viewer.userId, role: "viewer" },
      { siteId: site, userId: manager.userId, role: "manager" },
    ]);
    value(await runWarehouse(h, admin, receive(itemId, hiddenBin, 7, { lot: "RESTRICTED" })));
    value(
      await runWarehouse(
        h,
        admin,
        receive(itemId, bin, 2, { ownerOrganizationId: company.id, lot: "OWNED" }),
      ),
    );
    const command = receive(itemId, bin, 5, { lot: "INSPECTION" });
    const received = focus(await runWarehouse(h, manager, command));
    expect(await runWarehouse(h, viewer, receive(itemId, bin, 1))).toMatchObject({
      ok: false,
      error: "unavailable",
    });
    expect(await runWarehouse(h, manager, receive(itemId, hiddenBin, 1))).toMatchObject({
      ok: false,
      error: "unavailable",
    });
    const state = focus(
      await runWarehouse(h, manager, {
        type: "setPositionState",
        requestId: randomUUID(),
        id: received,
        state: "quarantine",
        quantity: 2,
      }),
    );
    expect(state).not.toBe(received);
    const visible = value(await warehouse(h, viewer));
    expect(visible.sites.map(({ id }) => id)).toEqual([site]);
    expect(visible.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: received, lot: "INSPECTION", onHand: 3, available: 3 }),
        expect.objectContaining({ id: state, state: "quarantine", onHand: 2, available: 0 }),
        expect.objectContaining({
          lot: "OWNED",
          owned: true,
          ownerOrganizationId: null,
          available: 0,
        }),
      ]),
    );
    expect(visible.positions).toHaveLength(3);
    expect(at(visible, itemId, bin)).toMatchObject({ onHand: 7, available: 3 });
    const scopedInventory = value(await readInventoryWorkspace(h.db, viewer, null, signal()));
    expect(scopedInventory.items.find(({ id }) => id === itemId)).toMatchObject({
      onHand: 7,
      reserved: 0,
      available: 3,
    });
    expect(value(await warehouse(h, viewer, { siteId: other })).positions).toEqual([]);
    await h.db
      .delete(directorySiteGrants)
      .where(
        and(eq(directorySiteGrants.siteId, site), eq(directorySiteGrants.userId, manager.userId)),
      );
    expect(await runWarehouse(h, manager, command)).toMatchObject({
      ok: false,
      error: "unavailable",
    });
    expect(await itemCounts(h, itemId)).toEqual({ onHand: 14, reserved: 0 });
  });

  it("retains serial uniqueness across sites, concurrent receipts, and a consumed position", async () => {
    const other = await activeSite(h, "SECOND");
    const otherBin = await activeBin(h, other, "B2");
    const receipts = await Promise.all([
      runWarehouse(h, admin, receive(itemId, bin, 1, { serial: " sm-2401 ", lot: "RUN-1" })),
      runWarehouse(h, admin, receive(itemId, otherBin, 1, { serial: "SM-2401" })),
    ]);
    expect(receipts.filter((result) => result.ok)).toHaveLength(1);
    expect(receipts.filter((result) => !result.ok)).toEqual([
      { ok: false, error: "duplicateSerial" },
    ]);
    expect(await itemCounts(h, itemId)).toEqual({ onHand: 1, reserved: 0 });
    const dealId = await salesDeal(h, admin);
    value(await finish(h, admin, await nativeOrder(h, admin, dealId, itemId, 1), "ship"));
    expect(
      await runWarehouse(h, admin, receive(itemId, bin, 1, { serial: "SM-2401" })),
    ).toMatchObject({ ok: false, error: "duplicateSerial" });
    expect(value(await warehouse(h, admin, { itemId, showEmpty: true })).positions).toMatchObject([
      { serial: "SM-2401", onHand: 0, reserved: 0, available: 0 },
    ]);
    expect(await itemCounts(h, itemId)).toEqual({ onHand: 0, reserved: 0 });
    const revisionB = await part(h, "DIN-WAREHOUSE-B", { revision: "B", familyId: itemId });
    value(await runWarehouse(h, admin, receive(revisionB, otherBin, 1, { serial: "SM-2401" })));
    const newer = value(await warehouse(h, admin, { itemId: revisionB }));
    expect(newer.parts.find(({ id }) => id === revisionB)).toMatchObject({
      code: "DIN-WAREHOUSE",
      revision: "B",
    });
    expect(newer.positions).toMatchObject([{ itemId: revisionB, serial: "SM-2401", onHand: 1 }]);
    expect(await itemCounts(h, itemId)).toEqual({ onHand: 0, reserved: 0 });
  });

  it("keeps receipts separate from incoming plans and rejects structural placement", async () => {
    const parent = await activeBin(h, site, "STRUCTURE");
    const child = await activeBin(h, site, "CHILD", parent);
    value(
      await runWarehouse(h, admin, {
        type: "saveLocationPolicy",
        requestId: randomUUID(),
        locationId: parent,
        kind: "structure",
      }),
    );
    expect(await runWarehouse(h, admin, receive(itemId, parent, 1))).toMatchObject({
      ok: false,
      error: "incompatibleLocation",
    });
    const plan = focus(
      await runWarehouse(h, admin, {
        type: "createIncoming",
        requestId: randomUUID(),
        itemId,
        locationId: child,
        quantity: 6,
        expectedDate: nearDate(5),
        reference: "Expected delivery",
        ownerOrganizationId: null,
      }),
    );
    expect(at(value(await warehouse(h, admin)), itemId, child)).toMatchObject({
      onHand: 0,
      reserved: 0,
      available: 0,
      incoming: 6,
    });
    expect(
      await executeLocationsCommand(
        h.db,
        admin,
        {
          type: "setLocationArchived",
          requestId: randomUUID(),
          id: child,
          archived: true,
        },
        signal(),
      ),
    ).toMatchObject({ ok: false, error: "warehouseStock" });
    value(
      await runWarehouse(h, admin, receive(itemId, child, 2, { incomingId: plan, lot: "PARTIAL" })),
    );
    expect(
      await runWarehouse(h, admin, receive(itemId, child, 5, { incomingId: plan })),
    ).toMatchObject({ ok: false, error: "planMismatch" });
    expect(at(value(await warehouse(h, admin)), itemId, child)).toMatchObject({
      onHand: 2,
      reserved: 0,
      available: 2,
      incoming: 4,
    });
    value(
      await runWarehouse(h, admin, { type: "cancelIncoming", requestId: randomUUID(), id: plan }),
    );
    expect(at(value(await warehouse(h, admin)), itemId, child)).toMatchObject({
      onHand: 2,
      reserved: 0,
      available: 2,
      incoming: 0,
    });
    expect(
      await runWarehouse(h, admin, {
        type: "saveLocationPolicy",
        requestId: randomUUID(),
        locationId: child,
        kind: "structure",
      }),
    ).toMatchObject({ ok: false, error: "conflict" });
  });
});

async function legacySnapshot(h: TestDb) {
  const [items, orders, movements, receipts] = await Promise.all([
    h.db.select().from(inventoryItems).orderBy(inventoryItems.id),
    h.db.select().from(inventoryOrders).orderBy(inventoryOrders.id),
    h.db.select().from(inventoryMovements).orderBy(inventoryMovements.id),
    h.db.select().from(inventoryCommandReceipts).orderBy(inventoryCommandReceipts.requestId),
  ]);
  return { items, orders, movements, receipts };
}

async function oldReadyOrder(
  h: TestDb,
  admin: NativeSessionRef,
  itemId: string,
): Promise<InventoryOrder> {
  const dealId = await salesDeal(h, admin);
  const id = randomUUID();
  await h.db.insert(inventoryOrders).values({
    id,
    itemId,
    dealId,
    quantity: 3,
    reserved: 3,
    buildQuantity: 0,
    status: "ready",
    createdBy: admin.userId,
  });
  const existingReceipt = { actorId: admin.userId, requestId: randomUUID() };
  await h.db
    .insert(inventoryCommandReceipts)
    .values({ ...existingReceipt, fingerprint: "a".repeat(64) });
  await h.db.insert(inventoryMovements).values([
    { ...existingReceipt, itemId, kind: "receipt", onHandDelta: 7, reservedDelta: 0 },
    {
      ...existingReceipt,
      itemId,
      orderId: id,
      kind: "order-reserve",
      onHandDelta: 0,
      reservedDelta: 3,
    },
  ]);
  return {
    id,
    itemId,
    dealId,
    quantity: 3,
    reserved: 3,
    buildQuantity: 0,
    status: "ready",
    revision: 1,
    projectId: null,
    tasks: [],
    materials: [],
  };
}

it("upgrades populated 0130 stock as an explicit unlocated balance and settles a legacy order", async () => {
  const h = await freshMigrationDb();
  const target = await migrationFolder(132);
  try {
    await installPrefix(h, 131);
    const admin = await staff(h, true);
    const siteId = await activeSite(h, "PREEXISTING");
    const locationId = await activeBin(h, siteId, "REAL-BIN");
    const itemId = await part(h, "LEGACY-STOCK", { onHand: 7, reserved: 3 });
    const order = await oldReadyOrder(h, admin, itemId);
    const before = await legacySnapshot(h);
    const ledgerBefore = await ledger(h);
    expect(ledgerBefore).toHaveLength(131);
    const success = { ok: true, value: { applied: true } };
    expect(await applyMigrations(h.db, AbortSignal.timeout(30_000), target.folder)).toEqual(
      success,
    );
    const migrated = await ledger(h);
    expect(migrated).toHaveLength(132);
    expect(migrated.slice(0, 131)).toEqual(ledgerBefore);
    const canonical = value(await readCanonicalMigrations(canonicalFolder, signal()));
    expect(canonical[131]?.tag).toBe("0131_inventory_warehouse");
    expect(migrated[131]?.hash).toBe(canonical[131]?.hash);
    expect(await legacySnapshot(h)).toEqual(before);
    expect(await h.db.select().from(inventoryStockPositions)).toEqual([]);
    expect(await applyMigrations(h.db, AbortSignal.timeout(30_000), target.folder)).toEqual(
      success,
    );
    expect(await ledger(h)).toEqual(migrated);

    // The running warehouse service also reads purchase plans introduced after 0131.
    expect(await applyMigrations(h.db, AbortSignal.timeout(30_000), canonicalFolder)).toEqual(
      success,
    );
    const currentLedger = await ledger(h);
    expect(currentLedger).toHaveLength(canonical.length);
    expect(currentLedger.slice(0, 132)).toEqual(migrated);
    expect(await legacySnapshot(h)).toEqual(before);
    const first = value(await warehouse(h, admin, { itemId }));
    expect(first.positions).toEqual([]);
    expect(at(first, itemId, null)).toMatchObject({
      onHand: 7,
      reserved: 3,
      available: 4,
      incoming: 0,
    });
    const reconciliation = {
      type: "reconcile",
      requestId: randomUUID(),
      itemId,
      locationId,
      quantity: 2,
      lot: "ALLOCATED-LEGACY",
      serial: null,
      expiryDate: null,
      state: "available",
      ownerOrganizationId: null,
    } as const satisfies WarehouseCommand;
    expect(await runWarehouse(h, admin, { ...reconciliation, quantity: 5 })).toMatchObject({
      ok: false,
      error: "insufficientStock",
    });
    const positionId = focus(await runWarehouse(h, admin, reconciliation));
    expect(focus(await runWarehouse(h, admin, reconciliation))).toBe(positionId);
    expect(await itemCounts(h, itemId)).toEqual({ onHand: 7, reserved: 3 });
    value(await finish(h, admin, order, "ship"));
    expect(await itemCounts(h, itemId)).toEqual({ onHand: 4, reserved: 0 });
    const after = value(await warehouse(h, admin, { itemId }));
    expect(at(after, itemId, null)).toMatchObject({ onHand: 2, reserved: 0, available: 2 });
    expect(at(after, itemId, locationId)).toMatchObject({ onHand: 2, reserved: 0, available: 2 });
    expect(await h.db.select().from(inventoryStockPositions)).toMatchObject([
      { id: positionId, itemId, onHand: 2, reserved: 0 },
    ]);
    expect(await applyMigrations(h.db, AbortSignal.timeout(30_000), canonicalFolder)).toEqual(
      success,
    );
    expect(await ledger(h)).toEqual(currentLedger);
  } finally {
    await target.dispose();
    await h.close();
  }
});
