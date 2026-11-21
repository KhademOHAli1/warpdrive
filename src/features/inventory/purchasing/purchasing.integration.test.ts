import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
} from "@/db/migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "@/db/migrationAdmissionSource";
import { settings } from "@/db/schema";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { confirmUpload, requestDownload, requestUpload } from "@/features/files/actions";
import { FakeStorageClient } from "@/features/files/storageFake";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { inventoryPartProfiles } from "../catalog/schema";
import { inventoryItems } from "../schema";
import { runInventoryCommand } from "../service";
import { inventorySupplierOffers } from "../sourcing/schema";
import {
  createSourcingActor,
  seedSourcing,
  setRole,
  sourceCommand,
  sourcing,
} from "../sourcing/sourcing.test-helpers";
import { incumbentRows, signal } from "../warehouse/operations/structures.test-helpers";
import { inventoryStockEvents, inventoryStockIncoming } from "../warehouse/schema";
import { readWarehouseWorkspace, runWarehouseCommand } from "../warehouse/service";
import type { PurchaseOrder, PurchaseOrderLine } from "./contracts";
import { purchaseOrderLineCosts, purchaseOrderLines, purchaseReceipts } from "./schema";
import { readPurchasingWorkspace, runPurchasingCommand } from "./service";

type Fixture = Awaited<ReturnType<typeof seedSourcing>>;
type PurchaseCommand = Parameters<typeof runPurchasingCommand>[2];

function command(h: TestDb, actor: NativeSessionRef, body: Record<string, unknown>) {
  const input: PurchaseCommand = { requestId: randomUUID(), ...body };
  return runPurchasingCommand(h.db, actor, input, signal());
}

async function order(
  h: TestDb,
  actor: NativeSessionRef,
  siteId: string,
  orderId: string,
): Promise<PurchaseOrder> {
  const result = await readPurchasingWorkspace(h.db, actor, { siteId, orderId }, signal());
  assert(result.ok);
  const row = result.value.orders.find(({ id }) => id === orderId);
  assert(row !== undefined);
  return row;
}

async function offer(
  h: TestDb,
  f: Fixture,
  itemId: string,
  partNumber: string,
  packQuantity: number,
) {
  const scope = { siteId: f.source.siteId, itemId };
  await h.db
    .update(inventoryPartProfiles)
    .set({ flags: sql`jsonb_set(${inventoryPartProfiles.flags}, '{purchasable}', 'true')` })
    .where(eq(inventoryPartProfiles.itemId, itemId));
  expect(
    await sourceCommand(h, f.admin, scope, {
      type: "saveOffer",
      id: null,
      expectedVersion: null,
      supplierOrganizationId: f.firstSupplier,
      manufacturerPartId: null,
      partNumber,
      packQuantity,
      approved: true,
      available: true,
    }),
  ).toEqual({ ok: true });
  const result = await sourcing(h, f.admin, scope);
  assert(result.ok);
  const [record] = result.value.offers;
  assert(record !== undefined);
  return record;
}

function receivedLine(
  line: PurchaseOrderLine,
  quantity: number,
  lot: string,
  serial: string | null = null,
) {
  return {
    lineId: line.id,
    quantity,
    lot,
    serial,
    expiryDate: "2099-12-31",
    disposition: "accepted",
    reason: null,
  };
}

it("upgrades populated 0135 records and can still fulfill the incumbent sale", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 136);
    const f = await seedSourcing(h);
    await offer(h, f, f.lot.itemId, "PRE-UPGRADE-25", 25);
    const before = await incumbentRows(h);
    const beforeOffers = await h.db.select().from(inventorySupplierOffers);
    const originalReceipts = await ledger(h);
    expect(originalReceipts).toHaveLength(136);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    const after = await ledger(h);
    const canonical = await readCanonicalMigrations(canonicalFolder, signal());
    assert(canonical.ok);
    expect(after).toHaveLength(canonical.value.length);
    expect(canonical.value[136]?.tag).toBe("0136_inventory_purchase_orders");
    expect(after[136]?.hash).toBe(canonical.value[136]?.hash);
    expect(after.slice(0, 136)).toEqual(originalReceipts);
    expect(await incumbentRows(h)).toEqual(before);
    expect(await h.db.select().from(inventorySupplierOffers)).toEqual(beforeOffers);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    expect(await ledger(h)).toEqual(after);
    expect(
      await runInventoryCommand(
        h.db,
        f.admin,
        { type: "ship", requestId: randomUUID(), orderId: f.orderId, revision: 1 },
        null,
        signal(),
      ),
    ).toMatchObject({ ok: true });
  } finally {
    await h.close();
  }
});

it("issues a priced multi-line order, protects its plans, and receives split lots with immutable evidence", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedSourcing(h);
    const [siteId, locationId] = [f.source.siteId, f.source.locationId];
    await h.db
      .insert(settings)
      .values({ id: true, baseCurrency: "USD" })
      .onConflictDoUpdate({
        target: settings.id,
        set: { baseCurrency: "USD" },
      });
    const buyer = await createSourcingActor(h, f.admin, "PO buyer", siteId, "buyer");
    const receiver = await createSourcingActor(h, f.admin, "Receiver", siteId, "warehouse_manager");
    const viewer = await createSourcingActor(
      h,
      f.admin,
      "Read-only warehouse",
      siteId,
      "warehouse_viewer",
    );
    const remote = await createSourcingActor(
      h,
      f.admin,
      "Remote receiver",
      f.remote.siteId,
      "warehouse_manager",
    );
    const costViewer = await createSourcingActor(
      h,
      f.admin,
      "Cost reviewer",
      siteId,
      "cost_viewer",
    );
    const bulkOffer = await offer(h, f, f.lot.itemId, "DIST-MODULE-25", 25);
    const serialOffer = await offer(h, f, f.child.itemId, "DIST-SERIAL-1", 1);
    const tier = {
      type: "setPriceTier",
      offerId: bulkOffer.id,
      minPacks: 3,
      currency: "USD",
      amount: "127.3456",
    };
    expect(await sourceCommand(h, f.admin, { siteId, itemId: f.lot.itemId }, tier)).toEqual({
      ok: true,
    });

    const draft = {
      type: "saveDraft",
      requestId: randomUUID(),
      id: null,
      expectedVersion: null,
      siteId,
      locationId,
      supplierOrganizationId: f.firstSupplier,
      reference: "PO-QA-136",
      expectedDate: "2099-11-01",
      lines: [
        { offerId: bulkOffer.id, packs: 3 },
        { offerId: serialOffer.id, packs: 1 },
      ],
    };
    expect(await command(h, receiver, draft)).toMatchObject({ ok: false });
    const created = await command(h, buyer, draft);
    assert(created.ok);
    const id = created.id;
    expect(await command(h, buyer, draft)).toEqual(created);
    const saved = await order(h, buyer, siteId, id);
    expect(saved.status).toBe("draft");
    const issue = { type: "issue", id, expectedVersion: saved.version, requestId: randomUUID() };
    expect(await command(h, buyer, issue)).toEqual({ ok: true, id });
    expect(await command(h, buyer, issue)).toEqual({ ok: true, id });

    const opened = await order(h, receiver, siteId, id);
    expect(opened.status).toBe("open");
    expect(opened).not.toHaveProperty("pricing");
    expect(await order(h, buyer, siteId, id)).not.toHaveProperty("pricing");
    const bulk = opened.lines.find(({ offerId }) => offerId === bulkOffer.id);
    const serialized = opened.lines.find(({ offerId }) => offerId === serialOffer.id);
    assert(bulk !== undefined && serialized !== undefined);
    expect(bulk).toMatchObject({ packQuantity: 25, packs: 3, orderedUnits: 75, receivedUnits: 0 });
    expect(serialized).toMatchObject({ orderedUnits: 1, receivedUnits: 0 });
    expect(
      await readPurchasingWorkspace(h.db, remote, { siteId, orderId: id }, signal()),
    ).toMatchObject({ ok: false });
    expect((await order(h, costViewer, siteId, id)).pricing).toEqual([
      { lineId: bulk.id, currency: "USD", amount: "127.3456", minPacks: 3 },
    ]);
    expect(
      await sourceCommand(h, f.admin, { siteId, itemId: f.lot.itemId }, { ...tier, amount: "100" }),
    ).toEqual({ ok: true });
    expect((await order(h, costViewer, siteId, id)).pricing?.[0]?.amount).toBe("127.3456");

    const [planLink] = await h.db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, bulk.id));
    assert(planLink?.incomingId != null);
    const incomingId = planLink.incomingId;
    const warehouseBefore = await readWarehouseWorkspace(h.db, receiver, { siteId }, signal());
    assert(warehouseBefore.ok);
    expect(warehouseBefore.value.incoming).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: incomingId, purchaseOrderId: id, quantity: 75, received: 0 }),
      ]),
    );
    expect(
      await runWarehouseCommand(
        h.db,
        receiver,
        { type: "cancelIncoming", requestId: randomUUID(), id: incomingId },
        signal(),
      ),
    ).toMatchObject({ ok: false });
    expect(
      await runWarehouseCommand(
        h.db,
        receiver,
        {
          type: "receive",
          requestId: randomUUID(),
          itemId: f.lot.itemId,
          locationId,
          quantity: 1,
          lot: "BYPASS",
          serial: null,
          expiryDate: null,
          state: "available",
          ownerOrganizationId: null,
          incomingId,
        },
        signal(),
      ),
    ).toMatchObject({ ok: false });

    const first = {
      type: "receive",
      id,
      expectedVersion: opened.version,
      requestId: randomUUID(),
      supplierSlip: "SLIP-001",
      lines: [
        receivedLine(bulk, 30, "PO-LOT-ONE"),
        {
          ...receivedLine(bulk, 10, "REJECTED-BATCH"),
          disposition: "rejected",
          reason: "Supplier confirmed transit damage",
        },
        receivedLine(serialized, 1, "PO-SERIAL-LOT", "PO-SERIAL-NEW"),
      ],
    };
    expect(await command(h, buyer, first)).toMatchObject({ ok: false });
    expect(await command(h, viewer, first)).toMatchObject({ ok: false });
    const oldRows = await incumbentRows(h);
    expect(
      await command(h, receiver, {
        ...first,
        lines: [first.lines[0], receivedLine(serialized, 1, "DUPLICATE", "CHILD-001")],
      }),
    ).toMatchObject({ ok: false });
    expect(await incumbentRows(h)).toEqual(oldRows);
    expect(await h.db.select().from(purchaseReceipts)).toHaveLength(0);

    expect(await command(h, receiver, first)).toEqual({ ok: true, id });
    expect(await command(h, receiver, first)).toEqual({ ok: true, id });
    const partial = await order(h, receiver, siteId, id);
    expect(partial.status).toBe("partial");
    expect(partial.lines.find((row) => row.id === bulk.id)?.receivedUnits).toBe(30);
    const [firstSlip] = partial.receipts;
    assert(firstSlip !== undefined);
    expect(firstSlip.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lot: "PO-LOT-ONE",
          quantity: 30,
          positionId: expect.any(String),
        }),
        expect.objectContaining({
          lot: "REJECTED-BATCH",
          disposition: "rejected",
          positionId: null,
        }),
        expect.objectContaining({ serial: "PO-SERIAL-NEW", positionId: expect.any(String) }),
      ]),
    );

    const second = {
      type: "receive",
      id,
      expectedVersion: partial.version,
      supplierSlip: "SLIP-002",
      lines: [receivedLine(bulk, 45, "PO-LOT-TWO")],
    };
    expect(
      await command(h, receiver, { ...second, lines: [receivedLine(bulk, 46, "OVER")] }),
    ).toMatchObject({ ok: false });
    expect(await command(h, receiver, second)).toEqual({ ok: true, id });
    const finished = await order(h, receiver, siteId, id);
    expect(finished.status).toBe("received");
    expect(finished.lines.find((row) => row.id === bulk.id)?.receivedUnits).toBe(75);
    const [stock] = await h.db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, f.lot.itemId));
    expect(stock).toMatchObject({ onHand: 85, reserved: 4 });
    const [plan] = await h.db
      .select()
      .from(inventoryStockIncoming)
      .where(eq(inventoryStockIncoming.id, incomingId));
    expect(plan).toMatchObject({ quantity: 75, received: 75 });
    expect(
      await h.db
        .select()
        .from(inventoryStockEvents)
        .where(eq(inventoryStockEvents.incomingId, incomingId)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "receipt", onHandDelta: 30 }),
        expect.objectContaining({ kind: "receipt", onHandDelta: 45 }),
      ]),
    );

    const packingSlip = {
      entityType: "inventory_purchase_receipt",
      entityId: firstSlip.id,
      filename: "packing-slip.pdf",
      contentType: "application/pdf",
      size: 24,
    } as const;
    const storage = new FakeStorageClient();
    const uploader = await hydrateActor(h.db, receiver.userId, signal());
    const reader = await hydrateActor(h.db, viewer.userId, signal());
    const outsider = await hydrateActor(h.db, remote.userId, signal());
    assert(uploader && reader && outsider);
    expect(
      await requestUpload(h.db, { actor: reader, storage, input: packingSlip }, signal()),
    ).toMatchObject({ ok: false });
    const upload = await requestUpload(
      h.db,
      { actor: uploader, storage, input: packingSlip },
      signal(),
    );
    assert(upload.ok);
    const objectKey = upload.value.post.fields.key;
    assert(objectKey !== undefined);
    storage.objectsByKey.set(objectKey, { size: 24, contentType: "application/pdf" });
    const fileId = upload.value.fileId;
    expect(await confirmUpload(h.db, { actor: uploader, storage, fileId }, signal())).toMatchObject(
      { ok: true },
    );
    expect(await requestDownload(h.db, { actor: reader, storage, fileId }, signal())).toMatchObject(
      { ok: true },
    );
    expect(
      await requestDownload(h.db, { actor: outsider, storage, fileId }, signal()),
    ).toMatchObject({ ok: false });
    await setRole(h, f.admin, viewer, siteId, "warehouse_viewer", false);
    expect(await requestDownload(h.db, { actor: reader, storage, fileId }, signal())).toMatchObject(
      { ok: false },
    );
    expect(await command(h, receiver, { ...first, supplierSlip: "CHANGED-SLIP" })).toMatchObject({
      ok: false,
    });
    await expect(
      h.db
        .update(purchaseOrderLineCosts)
        .set({ amount: "1" })
        .where(eq(purchaseOrderLineCosts.lineId, bulk.id)),
    ).rejects.toThrow();
    await expect(
      h.db.delete(purchaseReceipts).where(eq(purchaseReceipts.id, firstSlip.id)),
    ).rejects.toThrow();

    const extra = await command(h, buyer, {
      ...draft,
      requestId: randomUUID(),
      reference: "PO-CANCEL-136",
    });
    assert(extra.ok);
    const extraDraft = await order(h, buyer, siteId, extra.id);
    expect(
      await command(h, buyer, { type: "issue", id: extra.id, expectedVersion: extraDraft.version }),
    ).toEqual(extra);
    const extraOpened = await order(h, buyer, siteId, extra.id);
    expect(
      await command(h, buyer, {
        type: "cancel",
        id: extra.id,
        expectedVersion: extraOpened.version,
        reason: "Supplier discontinued the pending shipment",
      }),
    ).toEqual(extra);
    expect((await order(h, buyer, siteId, extra.id)).status).toBe("cancelled");
    const finalWarehouse = await readWarehouseWorkspace(h.db, receiver, { siteId }, signal());
    assert(finalWarehouse.ok);
    const cancelledPlans = finalWarehouse.value.incoming.filter(
      ({ purchaseOrderId }) => purchaseOrderId === extra.id,
    );
    expect(cancelledPlans).toHaveLength(2);
    expect(cancelledPlans.every(({ cancelled, received }) => cancelled && received === 0)).toBe(
      true,
    );
  } finally {
    await h.close();
  }
});
