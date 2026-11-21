import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
} from "@/db/migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "@/db/migrationAdmissionSource";
import { deals, organizations, permissionSets, pipelines, stages, users } from "@/db/schema";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { inventoryPartProfiles } from "../catalog/schema";
import { inventoryOrders } from "../schema";
import { runInventoryCommand } from "../service";
import { createSourcingActor, setRole } from "../sourcing/sourcing.test-helpers";
import {
  actor,
  counts,
  incumbentRows,
  position,
  seedStructures,
  signal,
  value,
} from "../warehouse/operations/structures.test-helpers";
import {
  inventoryStockAllocations,
  inventoryStockEvents,
  inventoryStockPositions,
} from "../warehouse/schema";
import { runWarehouseCommand } from "../warehouse/service";
import type { SalesQuery } from "./contracts";
import { readSalesWorkspace } from "./reads";
import { salesAllocationEvents, salesPackingChecks, salesShipmentLines } from "./schema";
import { runSalesCommand } from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;

function command(h: TestDb, who: NativeSessionRef, body: Record<string, unknown>) {
  return runSalesCommand(h.db, who, { requestId: randomUUID(), ...body }, signal());
}

async function detail(h: TestDb, who: NativeSessionRef, orderId: string, scope: SalesQuery = {}) {
  const { detail: order } = value(
    await readSalesWorkspace(h.db, who, { ...scope, orderId }, signal()),
  );
  assert(order !== null);
  return order;
}

async function crmDemand(h: TestDb) {
  const seller = await actor(h, "Industrial sales representative");
  const permissionSetId = randomUUID();
  await h.db
    .insert(permissionSets)
    .values({ id: permissionSetId, name: "Sell own deals", flags: { "deal.edit_own": true } });
  await h.db.update(users).set({ permissionSetId }).where(eq(users.id, seller.userId));
  const customerId = randomUUID();
  const pipelineId = randomUUID();
  const stageId = randomUUID();
  const dealId = randomUUID();
  await h.db.insert(organizations).values({
    id: customerId,
    name: "Instrumentation Customer",
    ownerId: seller.userId,
    visibilityLevel: "owner",
    address: { street: "Test Drive 1", city: "Berlin", postal: "10115", country: "DE" },
  });
  await h.db.insert(pipelines).values({ id: pipelineId, name: "Industrial enquiries" });
  await h.db.insert(stages).values({ id: stageId, pipelineId, name: "Awaiting order" });
  await h.db.insert(deals).values({
    id: dealId,
    pipelineId,
    stageId,
    orgId: customerId,
    title: "Private sensor enquiry",
    ownerId: seller.userId,
    visibilityLevel: "owner",
    currency: "EUR",
  });
  return { seller, dealId };
}

async function receive(
  h: TestDb,
  admin: NativeSessionRef,
  stock: {
    locationId: string;
    itemId: string;
    quantity: number;
    lot?: string;
    serial?: string;
    expiryDate?: string;
    state?: "hold";
  },
) {
  const result = await runWarehouseCommand(
    h.db,
    admin,
    {
      type: "receive",
      requestId: randomUUID(),
      locationId: stock.locationId,
      itemId: stock.itemId,
      quantity: stock.quantity,
      lot: stock.lot ?? null,
      serial: stock.serial ?? null,
      expiryDate: stock.expiryDate ?? null,
      ownerOrganizationId: null,
      incomingId: null,
      state: stock.state ?? "available",
    },
    signal(),
  );
  assert(result.ok && result.focusId !== undefined);
  return result.focusId;
}

it("upgrades populated 0140 stock and ships the incumbent order with its existing reservation", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 141);
    const fixture = await seedStructures(h);
    const before = await incumbentRows(h);
    const originalHistory = await ledger(h);
    expect(originalHistory).toHaveLength(141);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    const after = await ledger(h);
    const canonical = value(await readCanonicalMigrations(canonicalFolder, signal()));
    expect(after).toHaveLength(canonical.length);
    expect(canonical[141]?.tag).toBe("0141_inventory_sales_fulfillment");
    expect(after[141]?.hash).toBe(canonical[141]?.hash);
    expect(after.slice(0, 141)).toEqual(originalHistory);
    expect(await incumbentRows(h)).toEqual(before);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    expect(await ledger(h)).toEqual(after);

    expect(
      await runInventoryCommand(
        h.db,
        fixture.admin,
        {
          type: "ship",
          requestId: randomUUID(),
          orderId: fixture.orderId,
          revision: 1,
        },
        null,
        signal(),
      ),
    ).toMatchObject({ ok: true });
    expect(await position(h, fixture.lot.positionId)).toMatchObject({ onHand: 6, reserved: 0 });
  } finally {
    await h.close();
  }
});

it("keeps CRM pricing private while two checked partial shipments consume exact warehouse stock", async () => {
  const h = await makeTestDb();
  try {
    const fixture = await seedStructures(h);
    const { admin, source, remote, lot, parent } = fixture;
    const { seller, dealId } = await crmDemand(h);
    const manager = await createSourcingActor(
      h,
      admin,
      "Shipping manager",
      source.siteId,
      "warehouse_manager",
    );
    const viewer = await createSourcingActor(
      h,
      admin,
      "Warehouse observer",
      source.siteId,
      "warehouse_viewer",
    );
    const remoteManager = await createSourcingActor(
      h,
      admin,
      "Other site manager",
      remote.siteId,
      "warehouse_manager",
    );
    await h.db
      .update(inventoryPartProfiles)
      .set({ flags: sql`jsonb_set(${inventoryPartProfiles.flags}, '{trackable}', 'true')` })
      .where(eq(inventoryPartProfiles.itemId, parent.itemId));
    const early = await receive(h, admin, {
      ...source,
      itemId: lot.itemId,
      quantity: 2,
      lot: "EARLY",
      expiryDate: "2099-01-01",
    });
    const held = await receive(h, admin, {
      ...source,
      itemId: lot.itemId,
      quantity: 5,
      lot: "HELD",
      state: "hold",
    });
    const distant = await receive(h, admin, {
      ...remote,
      itemId: lot.itemId,
      quantity: 5,
      lot: "REMOTE",
    });
    const expired = await receive(h, admin, {
      ...source,
      itemId: lot.itemId,
      quantity: 4,
      lot: "EXPIRED",
      expiryDate: "2000-01-01",
    });

    const dealWorkspace = value(await readSalesWorkspace(h.db, seller, { dealId }, signal()));
    expect(dealWorkspace.deal).toMatchObject({
      id: dealId,
      customerName: "Instrumentation Customer",
      canOrder: true,
    });
    expect(dealWorkspace.sites.map(({ id }) => id)).toEqual(
      expect.arrayContaining([source.siteId, remote.siteId]),
    );
    const create = {
      type: "saveDraft",
      requestId: randomUUID(),
      orderId: null,
      version: null,
      dealId,
      siteId: source.siteId,
      reference: "SO-0141-A",
      dueDate: "2099-08-20",
      recipient: "Customer Receiving",
      address: "Test Drive 1\n10115 Berlin\nDE",
      currency: "EUR",
      charges: [{ label: "Freight", amount: "5.25" }],
      lines: [
        { itemId: lot.itemId, quantity: 12, unitPrice: "18.25", note: "Contracted rate" },
        { itemId: parent.itemId, quantity: 2, unitPrice: "42.50", note: null },
      ],
    };
    expect(await command(h, manager, create)).toEqual(unavailable);
    const saved = await command(h, seller, create);
    assert(saved.ok);
    expect(await command(h, seller, create)).toEqual(saved);
    const orderId = saved.id;
    const change = async (who: NativeSessionRef, body: Record<string, unknown>) =>
      command(h, who, { orderId, version: (await detail(h, admin, orderId)).version, ...body });
    const draft = await detail(h, seller, orderId);
    expect(draft).toMatchObject({
      status: "draft",
      canEdit: true,
      canFulfill: false,
      ordered: 14,
      allocated: 0,
      commercial: { currency: "EUR", charges: create.charges },
      delivery: { recipient: create.recipient, address: create.address },
    });
    expect(await readSalesWorkspace(h.db, manager, { orderId }, signal())).toEqual(unavailable);
    expect(await change(manager, { type: "issueOrder" })).toEqual(unavailable);
    expect(await change(seller, { type: "issueOrder" })).toMatchObject({ ok: true });
    const issued = await detail(h, manager, orderId);
    expect(issued).toMatchObject({
      status: "issued",
      dealId: null,
      customerName: null,
      commercial: null,
      canFulfill: true,
      canEdit: false,
      canCancel: false,
      backordered: 14,
      delivery: { recipient: create.recipient, address: create.address },
    });
    expect(issued.lines[0]).toMatchObject({ unitPrice: null, note: null });
    expect(await detail(h, viewer, orderId)).toMatchObject({ canFulfill: false, delivery: null });
    expect(await readSalesWorkspace(h.db, manager, { dealId, orderId }, signal())).toEqual(
      unavailable,
    );
    expect(await readSalesWorkspace(h.db, remoteManager, { orderId }, signal())).toEqual(
      unavailable,
    );
    expect(
      await readSalesWorkspace(h.db, seller, { siteId: remote.siteId, orderId }, signal()),
    ).toEqual(unavailable);
    const [bulk, serialized] = issued.lines;
    assert(bulk !== undefined && serialized !== undefined);
    expect(bulk.positions.map(({ id }) => id)).toEqual([early, lot.positionId]);
    for (const [positionId, error] of [
      [held, "stock"],
      [expired, "stock"],
      [distant, "unavailable"],
    ] as const) {
      expect(
        await change(manager, { type: "allocate", lineId: bulk.id, positionId, quantity: 1 }),
      ).toEqual({ ok: false, error });
    }
    expect(
      await change(manager, {
        type: "allocate",
        lineId: bulk.id,
        positionId: lot.positionId,
        quantity: 7,
      }),
    ).toEqual({ ok: false, error: "stock" });
    expect(await change(viewer, { type: "autoAllocate" })).toEqual(unavailable);
    expect(await change(seller, { type: "autoAllocate" })).toEqual(unavailable);
    expect(
      await change(manager, {
        type: "allocate",
        lineId: bulk.id,
        positionId: lot.positionId,
        quantity: 1,
      }),
    ).toMatchObject({ ok: true });
    expect(await change(manager, { type: "autoAllocate" })).toMatchObject({ ok: true });
    const filled = await detail(h, manager, orderId);
    expect(filled).toMatchObject({ allocated: 9, backordered: 5 });
    const firstBulk = filled.lines[0]?.allocations.find(({ positionId }) => positionId === early);
    const oldBulk = filled.lines[0]?.allocations.find(
      ({ positionId }) => positionId === lot.positionId,
    );
    const firstSerial = filled.lines[1]?.allocations[0];
    assert(firstBulk !== undefined && oldBulk !== undefined && firstSerial !== undefined);
    expect(firstBulk.quantity).toBe(2);
    expect(oldBulk.quantity).toBe(6);
    expect(firstSerial.serial).toBe("PARENT-001");
    expect(await detail(h, seller, orderId)).toMatchObject({
      allocated: 9,
      lines: [
        { allocated: 8, allocations: [], positions: [], unitPrice: "18.2500" },
        { allocated: 1, allocations: [], positions: [] },
      ],
    });

    const createShipment = async (
      reference: string,
      lines: { allocationId: string; quantity: number }[],
    ) => {
      const created = await change(manager, { type: "createShipment", reference, lines });
      assert(created.ok && created.shipmentId !== undefined);
      const shipment = (await detail(h, manager, orderId)).shipments.find(
        ({ id }) => id === created.shipmentId,
      );
      assert(shipment !== undefined);
      return shipment;
    };
    const outbound = await createShipment("PACK-1", [
      { allocationId: firstBulk.id, quantity: 2 },
      { allocationId: firstSerial.id, quantity: 1 },
    ]);
    expect(
      (await detail(h, manager, orderId)).lines[0]?.allocations.find(
        ({ id }) => id === firstBulk.id,
      ),
    ).toMatchObject({ committed: 2 });
    expect(
      await change(manager, { type: "deallocate", allocationId: firstBulk.id, quantity: 1 }),
    ).toEqual({ ok: false, error: "state" });
    expect(
      await change(manager, {
        type: "createShipment",
        reference: "PACK-DUPLICATE",
        lines: [{ allocationId: oldBulk.id, quantity: 1 }],
      }),
    ).toEqual({ ok: false, error: "state" });

    const check = (shipmentId: string, shipmentLineId: string, checked: boolean, scan?: string) =>
      change(manager, {
        type: "checkShipmentLine",
        shipmentId,
        shipmentLineId,
        checked,
        ...(scan === undefined ? {} : { scan }),
      });
    const bulkPacked = outbound.lines.find(({ lot: packedLot }) => packedLot === "EARLY");
    const serialPacked = outbound.lines.find(({ serial }) => serial === "PARENT-001");
    assert(bulkPacked !== undefined && serialPacked !== undefined);
    expect(await check(outbound.id, serialPacked.id, true, "WRONG-SERIAL")).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await check(outbound.id, serialPacked.id, true, "PARENT-001")).toMatchObject({
      ok: true,
    });
    expect(await check(outbound.id, serialPacked.id, false)).toMatchObject({ ok: true });
    expect(await check(outbound.id, bulkPacked.id, true, "EARLY")).toMatchObject({ ok: true });
    const post = {
      type: "postShipment",
      shipmentId: outbound.id,
      carrier: "Parcel carrier",
      tracking: "TRACE-0141-1",
      shippedOn: "2026-10-12",
    };
    expect(await change(manager, post)).toEqual({ ok: false, error: "state" });
    expect(await check(outbound.id, serialPacked.id, true, "PARENT-001")).toMatchObject({
      ok: true,
    });

    await expect(
      h.db
        .update(inventoryStockPositions)
        .set({ state: "hold" })
        .where(eq(inventoryStockPositions.id, early)),
    ).rejects.toMatchObject({
      cause: { constraint: "inventory_stock_position_allocatable_check" },
    });
    // Simulate a lot expiring after packing. Final shipment still rechecks the position.
    await h.db
      .update(inventoryStockPositions)
      .set({ expiryDate: "2000-01-01" })
      .where(eq(inventoryStockPositions.id, early));
    const posting = {
      ...post,
      orderId,
      version: (await detail(h, admin, orderId)).version,
      requestId: randomUUID(),
    };
    expect(await command(h, manager, posting)).toEqual({ ok: false, error: "stock" });
    expect(await position(h, early)).toMatchObject({ onHand: 2, reserved: 2 });
    expect(await position(h, parent.positionId)).toMatchObject({ onHand: 1, reserved: 1 });
    await h.db
      .update(inventoryStockPositions)
      .set({ expiryDate: "2099-01-01" })
      .where(eq(inventoryStockPositions.id, early));
    const posted = await command(h, manager, posting);
    expect(posted).toEqual({ ok: true, id: orderId, shipmentId: outbound.id });
    expect(await command(h, manager, posting)).toEqual(posted);
    expect(await command(h, manager, { ...posting, tracking: "MISMATCHED-RETRY" })).toEqual({
      ok: false,
      error: "conflict",
    });
    const partial = await detail(h, manager, orderId);
    expect(partial).toMatchObject({ status: "issued", shipped: 3, allocated: 6, backordered: 5 });
    const [postedPack] = partial.shipments;
    assert(postedPack !== undefined);
    expect(postedPack).toMatchObject({
      status: "shipped",
      tracking: "TRACE-0141-1",
      lines: expect.arrayContaining([
        expect.objectContaining({ serial: "PARENT-001", quantity: 1, eventId: expect.any(String) }),
        expect.objectContaining({ lot: "EARLY", quantity: 2, eventId: expect.any(String) }),
      ]),
    });
    expect((await detail(h, seller, orderId)).shipments[0]).toMatchObject({
      tracking: "TRACE-0141-1",
      lines: [
        { lot: null, serial: null, location: "", eventId: null },
        { lot: null, serial: null, location: "", eventId: null },
      ],
    });
    const checks = await h.db
      .select()
      .from(salesPackingChecks)
      .where(eq(salesPackingChecks.shipmentLineId, serialPacked.id));
    expect(checks).toHaveLength(3);
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checked: false, scan: null, actorId: manager.userId }),
        expect.objectContaining({ checked: true, scan: "PARENT-001", actorId: manager.userId }),
      ]),
    );
    await expect(
      h.db
        .update(salesShipmentLines)
        .set({ quantity: 3 })
        .where(eq(salesShipmentLines.id, bulkPacked.id)),
    ).rejects.toThrow();

    await receive(h, admin, { ...source, itemId: lot.itemId, quantity: 1, lot: "REPLENISH" });
    await receive(h, admin, {
      ...source,
      itemId: parent.itemId,
      quantity: 1,
      serial: "PARENT-002",
    });
    expect(await change(manager, { type: "autoAllocate" })).toMatchObject({ ok: true });
    const next = await detail(h, manager, orderId);
    const secondSerial = next.lines[1]?.allocations[0];
    assert(secondSerial !== undefined);
    const second = await createShipment("PACK-2", [
      { allocationId: oldBulk.id, quantity: 3 },
      { allocationId: secondSerial.id, quantity: 1 },
    ]);
    for (const packed of second.lines) {
      expect(
        await check(second.id, packed.id, true, packed.serial ?? packed.lot ?? undefined),
      ).toMatchObject({ ok: true });
    }
    expect(
      await change(manager, { ...post, shipmentId: second.id, tracking: "TRACE-0141-2" }),
    ).toMatchObject({ ok: true });
    const later = await detail(h, manager, orderId);
    expect(later).toMatchObject({ status: "issued", shipped: 7, allocated: 4, backordered: 3 });
    expect(later.shipments.filter(({ status }) => status === "shipped")).toHaveLength(2);
    const waiting = await createShipment("PACK-CANCELLED", [
      { allocationId: oldBulk.id, quantity: 1 },
    ]);
    await h.db
      .update(inventoryPartProfiles)
      .set({ visibility: "admin" })
      .where(eq(inventoryPartProfiles.itemId, parent.itemId));
    expect(await readSalesWorkspace(h.db, seller, { orderId }, signal())).toEqual(unavailable);
    expect(await readSalesWorkspace(h.db, viewer, { orderId }, signal())).toEqual(unavailable);
    expect(await command(h, manager, posting)).toEqual(unavailable);
    await h.db
      .update(inventoryPartProfiles)
      .set({ visibility: "staff" })
      .where(eq(inventoryPartProfiles.itemId, parent.itemId));
    await setRole(h, admin, manager, source.siteId, "warehouse_manager", false);
    expect(await readSalesWorkspace(h.db, manager, { orderId }, signal())).toEqual(unavailable);
    expect(await command(h, manager, posting)).toEqual(unavailable);

    const beforeCancel = await counts(h, lot.itemId);
    expect(
      await change(seller, { type: "cancelOrder", reason: "Do not ship the remaining stock" }),
    ).toMatchObject({ ok: true });
    const cancelled = await detail(h, admin, orderId);
    expect(cancelled).toMatchObject({
      status: "cancelled",
      shipped: 7,
      allocated: 0,
      backordered: 0,
    });
    expect(cancelled.shipments.find(({ id }) => id === waiting.id)).toMatchObject({
      status: "cancelled",
    });
    expect(cancelled.shipments.filter(({ status }) => status === "shipped")).toHaveLength(2);
    expect(await counts(h, lot.itemId)).toEqual({ onHand: beforeCancel?.onHand, reserved: 4 });
    expect(await counts(h, parent.itemId)).toEqual({ onHand: 0, reserved: 0 });
    const [incumbent] = await h.db
      .select()
      .from(inventoryOrders)
      .where(eq(inventoryOrders.id, fixture.orderId));
    expect(incumbent).toMatchObject({ status: "ready", reserved: 4 });
    const [legacy] = await h.db
      .select()
      .from(inventoryStockAllocations)
      .where(eq(inventoryStockAllocations.orderId, fixture.orderId));
    expect(legacy).toMatchObject({ quantity: 4, positionId: lot.positionId });

    const shipmentEvents = await h.db
      .select({ event: inventoryStockEvents, link: salesAllocationEvents })
      .from(salesAllocationEvents)
      .innerJoin(inventoryStockEvents, eq(inventoryStockEvents.id, salesAllocationEvents.eventId))
      .where(
        and(
          eq(salesAllocationEvents.orderId, orderId),
          eq(inventoryStockEvents.kind, "sales-shipment"),
        ),
      );
    expect(shipmentEvents.map(({ event }) => event.onHandDelta).sort((a, b) => a - b)).toEqual([
      -3, -2, -1, -1,
    ]);
    for (const { event, link } of shipmentEvents) {
      expect(event).toMatchObject({
        orderId: null,
        positionId: link.positionId,
        reservedDelta: event.onHandDelta,
      });
      expect(
        cancelled.shipments
          .flatMap(({ lines }) => lines)
          .some(({ eventId }) => eventId === event.id),
      ).toBe(true);
    }
  } finally {
    await h.close();
  }
});
