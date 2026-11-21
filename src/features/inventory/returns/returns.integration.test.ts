import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
import { readSalesWorkspace } from "../sales/reads";
import { salesShipmentLines, salesShipments } from "../sales/schema";
import { runSalesCommand } from "../sales/service";
import { createSourcingActor } from "../sourcing/sourcing.test-helpers";
import {
  actor,
  counts,
  incumbentRows,
  position,
  seedStructures,
  signal,
  value,
} from "../warehouse/operations/structures.test-helpers";
import { inventoryStockEvents, inventoryStockPositions } from "../warehouse/schema";
import { runWarehouseCommand } from "../warehouse/service";
import type { ReturnCommand } from "./contracts";
import { readReturnsWorkspace } from "./reads";
import { returnDispositions, returnReceipts } from "./schema";
import { runReturnCommand } from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;
const exceedsStock = { ok: false, error: "stock" } as const;
type Draft = Extract<ReturnCommand, { type: "saveDraft" }>;

async function crmDemand(h: TestDb) {
  const seller = await actor(h, "Seller");
  const nextSeller = await actor(h, "Successor in CRM");
  const permissionSetId = randomUUID();
  await h.db
    .insert(permissionSets)
    .values({ id: permissionSetId, name: "Sell own deals", flags: { "deal.edit_own": true } });
  await h.db
    .update(users)
    .set({ permissionSetId })
    .where(inArray(users.id, [seller.userId, nextSeller.userId]));
  const orgId = randomUUID();
  const pipelineId = randomUUID();
  const stageId = randomUUID();
  const dealId = randomUUID();
  await h.db.insert(organizations).values({
    id: orgId,
    name: "Industrial Instrumentation Customer",
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
    orgId,
    title: "Private sensor enquiry",
    ownerId: seller.userId,
    visibilityLevel: "owner",
    currency: "EUR",
  });
  return { seller, nextSeller, dealId, orgId };
}

async function postSale(
  h: TestDb,
  scope: { seller: NativeSessionRef; manager: NativeSessionRef; dealId: string; siteId: string },
  ref: string,
  lines: { itemId: string; ordered: number; shipped: number }[],
) {
  const { seller, manager, dealId, siteId } = scope;
  const created = await runSalesCommand(
    h.db,
    seller,
    {
      type: "saveDraft",
      requestId: randomUUID(),
      orderId: null,
      version: null,
      dealId,
      siteId,
      reference: `SO-${ref}`,
      dueDate: null,
      recipient: "Customer receiving",
      address: "Test Drive 1\n10115 Berlin\nDE",
      currency: "EUR",
      charges: [],
      lines: lines.map(({ itemId, ordered }) => ({
        itemId,
        quantity: ordered,
        unitPrice: "150.50",
        note: null,
      })),
    },
    signal(),
  );
  assert(created.ok);
  const orderId = created.id;
  const order = async (who: NativeSessionRef) => {
    const { detail } = value(await readSalesWorkspace(h.db, who, { orderId }, signal()));
    assert(detail !== null);
    return detail;
  };
  const change = async (who: NativeSessionRef, body: Record<string, unknown>) =>
    runSalesCommand(
      h.db,
      who,
      { orderId, version: (await order(who)).version, requestId: randomUUID(), ...body },
      signal(),
    );
  expect(await change(seller, { type: "issueOrder" })).toMatchObject({ ok: true });
  expect(await change(manager, { type: "autoAllocate" })).toMatchObject({ ok: true });
  const allocations = (await order(manager)).lines.map((line, index) => {
    const allocation = line.allocations[0];
    const input = lines[index];
    assert(allocation !== undefined && input !== undefined);
    expect(line.itemId).toBe(input.itemId);
    return { allocationId: allocation.id, quantity: input.shipped };
  });
  const createdShipment = await change(manager, {
    type: "createShipment",
    reference: `SHIP-${ref}`,
    lines: allocations,
  });
  assert(createdShipment.ok && createdShipment.shipmentId !== undefined);
  const shipmentId = createdShipment.shipmentId;
  const shipment = (await order(manager)).shipments.find(({ id }) => id === shipmentId);
  assert(shipment !== undefined);
  for (const line of shipment.lines) {
    const scan = line.serial ?? line.lot;
    assert(scan !== null);
    expect(
      await change(manager, {
        type: "checkShipmentLine",
        shipmentId,
        shipmentLineId: line.id,
        checked: true,
        scan,
      }),
    ).toMatchObject({ ok: true });
  }
  expect(
    await change(manager, {
      type: "postShipment",
      shipmentId,
      carrier: "Local freight",
      tracking: `TRACK-${ref}`,
      shippedOn: "2026-10-12",
    }),
  ).toMatchObject({ ok: true });
  const packed = await h.db
    .select()
    .from(salesShipmentLines)
    .where(eq(salesShipmentLines.shipmentId, shipmentId))
    .orderBy(asc(salesShipmentLines.id));
  expect(packed).toHaveLength(lines.length);
  expect(packed.every(({ checked, eventId }) => checked && eventId !== null)).toBe(true);
  return { shipmentId, packed };
}

async function returnFixture(h: TestDb) {
  const stock = await seedStructures(h);
  const { admin, source, remote, lot, parent } = stock;
  await h.db
    .update(inventoryPartProfiles)
    .set({ flags: sql`jsonb_set(${inventoryPartProfiles.flags}, '{trackable}', 'true')` })
    .where(eq(inventoryPartProfiles.itemId, parent.itemId));
  const { seller, nextSeller, dealId, orgId } = await crmDemand(h);
  const shipper = await createSourcingActor(
    h,
    admin,
    "Origin shipping manager",
    source.siteId,
    "warehouse_manager",
  );
  const receiver = await createSourcingActor(
    h,
    admin,
    "Returns manager",
    remote.siteId,
    "warehouse_manager",
  );
  const observer = await createSourcingActor(
    h,
    admin,
    "Returns observer",
    remote.siteId,
    "warehouse_viewer",
  );
  const posted = await postSale(
    h,
    { seller, manager: shipper, dealId, siteId: source.siteId },
    "OEM-0141",
    [
      { itemId: parent.itemId, ordered: 1, shipped: 1 },
      { itemId: lot.itemId, ordered: 3, shipped: 2 },
    ],
  );
  const serial = posted.packed.find(({ itemId }) => itemId === parent.itemId);
  const bulk = posted.packed.find(({ itemId }) => itemId === lot.itemId);
  assert(serial !== undefined && bulk !== undefined);
  expect(serial).toMatchObject({ positionId: parent.positionId, serial: "PARENT-001" });
  expect(bulk).toMatchObject({ positionId: lot.positionId, lot: "MODULE-LOT-01" });
  return {
    ...stock,
    seller,
    nextSeller,
    dealId,
    orgId,
    shipper,
    receiver,
    observer,
    posted,
    serial,
    bulk,
  };
}

function draftInput(
  shipmentId: string,
  siteId: string,
  reference: string,
  lines: Draft["lines"],
): Draft {
  return {
    type: "saveDraft",
    caseId: null,
    version: null,
    requestId: randomUUID(),
    shipmentId,
    siteId,
    reference,
    note: "Private assessment",
    charges: [{ label: "Return freight", amount: "15.50" }],
    lines,
  };
}

async function returnDetail(h: TestDb, who: NativeSessionRef, caseId: string) {
  const { detail } = value(await readReturnsWorkspace(h.db, who, { caseId }, signal()));
  assert(detail !== null);
  return detail;
}

function workspaceCase(h: TestDb, admin: NativeSessionRef, caseId: string) {
  return {
    detail: (who = admin) => returnDetail(h, who, caseId),
    async change(who: NativeSessionRef, body: Record<string, unknown>) {
      const { version } = await returnDetail(h, admin, caseId);
      return runReturnCommand(
        h.db,
        who,
        { caseId, version, requestId: randomUUID(), ...body },
        signal(),
      );
    },
  };
}

function lineFor(detail: Awaited<ReturnType<typeof returnDetail>>, shipmentLineId: string) {
  const line = detail.lines.find((entry) => entry.shipmentLineId === shipmentLineId);
  assert(line !== undefined);
  return line;
}

it("upgrades a populated 0141 shipment and controls custody separately from CRM decisions", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 142);
    const f = await returnFixture(h);
    const originalStock = await incumbentRows(h);
    const oldLedger = await ledger(h);
    expect(oldLedger).toHaveLength(142);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    const canonical = value(await readCanonicalMigrations(canonicalFolder, signal()));
    const applied = await ledger(h);
    expect(applied.slice(0, 142)).toEqual(oldLedger);
    expect(applied).toHaveLength(canonical.length);
    expect(canonical[142]?.tag).toBe("0142_inventory_customer_returns");
    expect(applied[142]?.hash).toBe(canonical[142]?.hash);
    expect(await incumbentRows(h)).toEqual(originalStock);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    expect(await ledger(h)).toEqual(applied);

    const draft = draftInput(f.posted.shipmentId, f.remote.siteId, "RMA-0142-A", [
      { shipmentLineId: f.serial.id, quantity: 1, reason: "No signal" },
      { shipmentLineId: f.bulk.id, quantity: 2, reason: "Wrong variant" },
    ]);
    const run = (who: NativeSessionRef, command: unknown) =>
      runReturnCommand(h.db, who, command, signal());
    expect(await run(f.receiver, draft)).toEqual(unavailable);
    const saved = await run(f.seller, draft);
    assert(saved.ok);
    expect(await run(f.seller, draft)).toEqual(saved);
    const first = workspaceCase(h, f.admin, saved.id);
    expect(await readReturnsWorkspace(h.db, f.receiver, { caseId: saved.id }, signal())).toEqual(
      unavailable,
    );
    expect(await first.change(f.receiver, { type: "issue" })).toEqual(unavailable);
    expect(await first.change(f.seller, { type: "issue" })).toEqual(saved);
    expect(await first.detail(f.seller)).toMatchObject({
      status: "issued",
      canEdit: true,
      canReceive: false,
      currency: "EUR",
      note: draft.note,
      charges: draft.charges,
    });
    expect(await first.detail(f.observer)).toMatchObject({
      status: "issued",
      canEdit: false,
      canReceive: false,
      canDispose: false,
      canCommercial: false,
      note: null,
      charges: null,
      currency: null,
    });
    expect(await readReturnsWorkspace(h.db, f.shipper, { caseId: saved.id }, signal())).toEqual(
      unavailable,
    );
    const serial = lineFor(await first.detail(f.receiver), f.serial.id);
    const bulk = lineFor(await first.detail(f.receiver), f.bulk.id);
    const receiveSerial = {
      type: "receive",
      lineId: serial.id,
      locationId: f.remote.locationId,
      quantity: 1,
      serial: serial.serial,
      condition: "used",
      note: "Signals intermittent",
    };
    expect(await first.change(f.seller, { type: "hold", reason: "Confirm serial" })).toEqual(saved);
    expect(await first.change(f.receiver, receiveSerial)).toEqual({ ok: false, error: "state" });
    expect(await first.change(f.seller, { type: "resume", reason: "Serial verified" })).toEqual(
      saved,
    );
    for (const who of [f.seller, f.observer, f.shipper]) {
      expect(await first.change(who, receiveSerial)).toEqual(unavailable);
    }
    expect(
      await first.change(f.receiver, { ...receiveSerial, locationId: f.source.locationId }),
    ).toEqual(unavailable);
    expect(await first.change(f.receiver, { ...receiveSerial, serial: "UNKNOWN" })).toEqual({
      ok: false,
      error: "invalid",
    });

    const claim = { ...receiveSerial, caseId: saved.id, version: (await first.detail()).version };
    const attempts = [
      { ...claim, requestId: randomUUID() },
      { ...claim, requestId: randomUUID() },
    ];
    const raced = await Promise.all(attempts.map((command) => run(f.receiver, command)));
    expect(raced).toEqual(expect.arrayContaining([saved, { ok: false, error: "stale" }]));
    const winningCommand = attempts[raced.findIndex(({ ok }) => ok)];
    assert(winningCommand !== undefined);
    expect(await run(f.receiver, winningCommand)).toEqual(saved);
    expect(await first.change(f.receiver, receiveSerial)).toEqual(exceedsStock);

    const [serialReceipt] = lineFor(await first.detail(f.receiver), f.serial.id).receipts;
    assert(serialReceipt !== undefined);
    expect(serialReceipt).toMatchObject({
      positionId: f.parent.positionId,
      physical: "quarantine",
      condition: "used",
      quantity: 1,
    });
    expect(await position(h, f.parent.positionId)).toMatchObject({
      siteId: f.remote.siteId,
      locationId: f.remote.locationId,
      onHand: 1,
      reserved: 0,
      state: "quarantine",
    });
    expect(await counts(h, f.parent.itemId)).toEqual({ onHand: 1, reserved: 0 });
    expect(
      (
        await runWarehouseCommand(
          h.db,
          f.receiver,
          {
            type: "setPositionState",
            requestId: randomUUID(),
            id: f.parent.positionId,
            quantity: 1,
            state: "available",
          },
          signal(),
        )
      ).ok,
    ).toBe(false);
    await expect(
      h.db
        .update(inventoryStockPositions)
        .set({ state: "available" })
        .where(eq(inventoryStockPositions.id, f.parent.positionId)),
    ).rejects.toThrow();
    expect(await first.change(f.receiver, { type: "complete" })).toEqual({
      ok: false,
      error: "state",
    });

    const receiveBulk = { ...receiveSerial, lineId: bulk.id, serial: null, condition: "damaged" };
    expect(await first.change(f.receiver, { ...receiveBulk, quantity: 3 })).toEqual(exceedsStock);
    expect(await first.change(f.receiver, receiveBulk)).toEqual(saved);
    expect(lineFor(await first.detail(f.receiver), f.bulk.id).received).toBe(1);
    expect(await first.change(f.receiver, receiveBulk)).toEqual(saved);
    expect(await first.change(f.receiver, receiveBulk)).toEqual(exceedsStock);
    const [scrapped, restocked] = lineFor(await first.detail(f.receiver), f.bulk.id).receipts;
    assert(scrapped !== undefined && restocked !== undefined);
    expect(new Set([scrapped.positionId, restocked.positionId, f.lot.positionId]).size).toBe(3);
    expect(await position(h, f.lot.positionId)).toMatchObject({ onHand: 8, reserved: 5 });

    const disposition = {
      type: "disposition",
      reason: "Bench inspection",
      receiptId: serialReceipt.id,
    };
    expect(await first.change(f.receiver, { ...disposition, kind: "repair" })).toEqual(saved);
    expect(await position(h, f.parent.positionId)).toMatchObject({
      state: "quarantine",
      onHand: 1,
    });
    expect(await first.change(f.receiver, { ...disposition, kind: "restock" })).toEqual(saved);
    expect(
      await first.change(f.receiver, { ...disposition, receiptId: scrapped.id, kind: "scrap" }),
    ).toEqual(saved);
    expect(
      await first.change(f.receiver, { ...disposition, receiptId: restocked.id, kind: "restock" }),
    ).toEqual(saved);
    expect(await position(h, scrapped.positionId)).toMatchObject({ lot: f.bulk.lot, onHand: 0 });
    expect(await position(h, restocked.positionId)).toMatchObject({
      lot: f.bulk.lot,
      onHand: 1,
      state: "available",
    });
    expect(await counts(h, f.lot.itemId)).toEqual({ onHand: 9, reserved: 5 });

    const refund = {
      type: "commercial",
      receiptId: serialReceipt.id,
      kind: "refund",
      amount: "125.50",
      reference: "Credit memo handoff",
      reason: "Private settlement",
    };
    expect(await first.change(f.receiver, refund)).toEqual(unavailable);
    expect(await first.change(f.seller, { ...refund, amount: "150.51" })).toEqual({
      ok: false,
      error: "invalid",
    });
    await h.db.transaction(async (tx) => {
      await tx
        .update(organizations)
        .set({ ownerId: f.nextSeller.userId })
        .where(eq(organizations.id, f.orgId));
      await tx.update(deals).set({ ownerId: f.nextSeller.userId }).where(eq(deals.id, f.dealId));
    });
    expect(await first.change(f.seller, refund)).toEqual(unavailable);
    expect(await readReturnsWorkspace(h.db, f.seller, { caseId: saved.id }, signal())).toEqual(
      unavailable,
    );
    expect(await first.change(f.nextSeller, refund)).toEqual(saved);
    expect(await first.change(f.nextSeller, refund)).toEqual({ ok: false, error: "conflict" });
    expect(await first.change(f.receiver, { type: "complete" })).toEqual(saved);
    const completed = await first.detail(f.nextSeller);
    expect(completed).toMatchObject({
      status: "completed",
      received: 3,
      shipmentId: f.posted.shipmentId,
    });
    expect(lineFor(completed, f.serial.id).receipts[0]?.commercial).toMatchObject({
      kind: "refund",
      amount: "125.5000",
      reference: refund.reference,
    });
    const warehouseDetail = await first.detail(f.observer);
    expect(lineFor(warehouseDetail, f.serial.id).receipts[0]?.commercial).toBeNull();
    expect(warehouseDetail.history.some(({ type }) => type === "commercial")).toBe(false);

    const copied = await first.change(f.nextSeller, { type: "duplicate", reference: "RMA-COPY" });
    assert(copied.ok);
    expect(await returnDetail(h, f.nextSeller, copied.id)).toMatchObject({
      status: "draft",
      lines: [],
    });
    expect(
      await workspaceCase(h, f.admin, copied.id).change(f.nextSeller, { type: "issue" }),
    ).toEqual({ ok: false, error: "invalid" });
    expect(
      await workspaceCase(h, f.admin, copied.id).change(f.nextSeller, {
        type: "cancel",
        reason: "No eligible shipped quantity",
      }),
    ).toEqual(copied);
    expect(
      await h.db
        .select()
        .from(salesShipmentLines)
        .where(eq(salesShipmentLines.shipmentId, f.posted.shipmentId))
        .orderBy(asc(salesShipmentLines.id)),
    ).toEqual(f.posted.packed);
    const [originalShipment] = await h.db
      .select()
      .from(salesShipments)
      .where(eq(salesShipments.id, f.posted.shipmentId));
    expect(originalShipment).toMatchObject({ status: "shipped", tracking: "TRACK-OEM-0141" });
    expect(
      await h.db.select().from(returnReceipts).where(eq(returnReceipts.caseId, saved.id)),
    ).toHaveLength(3);
    expect(
      (
        await h.db
          .select()
          .from(returnDispositions)
          .where(eq(returnDispositions.receiptId, serialReceipt.id))
      ).map(({ kind, eventId }) => ({ kind, auditableStockEvent: eventId !== null })),
    ).toEqual(
      expect.arrayContaining([
        { kind: "repair", auditableStockEvent: false },
        { kind: "restock", auditableStockEvent: true },
      ]),
    );
    const result = await h.db
      .select()
      .from(inventoryStockEvents)
      .where(
        and(
          eq(inventoryStockEvents.positionId, f.parent.positionId),
          inArray(inventoryStockEvents.kind, ["customer-return", "return-restock"]),
        ),
      );
    expect(result).toHaveLength(2);
    expect(
      result.map(({ kind, onHandDelta, reservedDelta }) => ({ kind, onHandDelta, reservedDelta })),
    ).toEqual(
      expect.arrayContaining([
        { kind: "customer-return", onHandDelta: 1, reservedDelta: 0 },
        { kind: "return-restock", onHandDelta: 0, reservedDelta: 0 },
      ]),
    );
  } finally {
    await h.close();
  }
});

it("fences concurrent return authorizations and accepts the same unit after a new posted shipment", async () => {
  const h = await makeTestDb();
  try {
    const f = await returnFixture(h);
    const run = (who: NativeSessionRef, command: unknown) =>
      runReturnCommand(h.db, who, command, signal());
    const requested = [
      { shipmentLineId: f.serial.id, quantity: 1, reason: "Returned after acceptance test" },
    ];
    const draftA = await run(
      f.seller,
      draftInput(f.posted.shipmentId, f.remote.siteId, "RMA-COMPETE-A", requested),
    );
    const draftB = await run(
      f.seller,
      draftInput(f.posted.shipmentId, f.remote.siteId, "RMA-COMPETE-B", requested),
    );
    assert(draftA.ok && draftB.ok);
    const contenders = [draftA.id, draftB.id].map((id) => workspaceCase(h, f.admin, id));
    const issued = await Promise.all(
      contenders.map((entry) => entry.change(f.seller, { type: "issue" })),
    );
    expect(issued.filter(({ ok }) => ok)).toHaveLength(1);
    expect(issued).toContainEqual(exceedsStock);
    const first = contenders[issued.findIndex(({ ok }) => ok)];
    assert(first !== undefined);
    const receiptInput = {
      type: "receive",
      quantity: 1,
      serial: f.serial.serial,
      condition: "unopened",
      note: null,
    };
    const line = lineFor(await first.detail(f.receiver), f.serial.id);
    expect(
      await first.change(f.receiver, {
        ...receiptInput,
        lineId: line.id,
        locationId: f.remote.locationId,
      }),
    ).toMatchObject({ ok: true });
    const [receipt] = lineFor(await first.detail(f.receiver), f.serial.id).receipts;
    assert(receipt !== undefined);
    expect(
      await first.change(f.receiver, {
        type: "disposition",
        kind: "restock",
        receiptId: receipt.id,
        reason: "Unopened package",
      }),
    ).toMatchObject({ ok: true });
    expect(await first.change(f.receiver, { type: "complete" })).toMatchObject({ ok: true });
    expect(
      await run(
        f.seller,
        draftInput(f.posted.shipmentId, f.remote.siteId, "RMA-OLD-AGAIN", requested),
      ),
    ).toEqual(exceedsStock);

    const nextSale = await postSale(
      h,
      {
        seller: f.seller,
        manager: f.receiver,
        dealId: f.dealId,
        siteId: f.remote.siteId,
      },
      "OEM-RESALE",
      [{ itemId: f.parent.itemId, ordered: 1, shipped: 1 }],
    );
    const [newPacked] = nextSale.packed;
    assert(newPacked !== undefined);
    expect(newPacked).toMatchObject({ serial: f.serial.serial, positionId: f.parent.positionId });
    expect(newPacked.id).not.toBe(f.serial.id);
    expect(newPacked.eventId).not.toBe(f.serial.eventId);
    const secondDraft = await run(
      f.seller,
      draftInput(nextSale.shipmentId, f.source.siteId, "RMA-RESALE", [
        { shipmentLineId: newPacked.id, quantity: 1, reason: "Returned by second recipient" },
      ]),
    );
    assert(secondDraft.ok);
    const second = workspaceCase(h, f.admin, secondDraft.id);
    expect(await second.change(f.seller, { type: "issue" })).toEqual(secondDraft);
    const secondLine = lineFor(await second.detail(f.shipper), newPacked.id);
    expect(
      await second.change(f.shipper, {
        ...receiptInput,
        lineId: secondLine.id,
        locationId: f.source.locationId,
      }),
    ).toEqual(secondDraft);
    const [back] = lineFor(await second.detail(f.shipper), newPacked.id).receipts;
    assert(back !== undefined);
    expect(back.positionId).toBe(receipt.positionId);
    expect(back.eventId).not.toBe(receipt.eventId);
    expect(await position(h, f.parent.positionId)).toMatchObject({
      onHand: 1,
      reserved: 0,
      serial: f.serial.serial,
      siteId: f.source.siteId,
      state: "quarantine",
    });
    expect(await first.detail(f.receiver)).toMatchObject({ status: "completed", received: 1 });
  } finally {
    await h.close();
  }
});
