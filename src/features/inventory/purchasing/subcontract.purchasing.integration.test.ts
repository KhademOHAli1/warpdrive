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
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directoryLocations } from "@/features/locations/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createLegacyPartProfile } from "../catalog/policy";
import { inventoryPartProfiles } from "../catalog/schema";
import { inventoryProductionBuilds, inventoryProductionOutputs } from "../production/buildSchema";
import type { ProductionIntent } from "../production/contracts";
import { readProductionWorkspace, runProductionCommand } from "../production/service";
import {
  type ApprovedBomLine,
  inventoryProductReleases,
  inventoryReleaseArtifacts,
} from "../releases/schema";
import { inventoryItems } from "../schema";
import { runInventoryCommand } from "../service";
import {
  createSourcingActor,
  seedSourcing,
  sourceCommand,
  sourcing,
} from "../sourcing/sourcing.test-helpers";
import {
  inventorySubcontractConsumptions,
  inventorySubcontractDispatches,
  inventorySubcontractReceipts,
  inventorySubcontractReturns,
} from "../subcontract/schema";
import {
  counts,
  incumbentRows,
  position,
  signal,
  value,
} from "../warehouse/operations/structures.test-helpers";
import { inventoryStockEvents } from "../warehouse/schema";
import { runWarehouseCommand } from "../warehouse/service";
import type { PurchaseOrder } from "./contracts";
import { purchaseReceiptLines } from "./schema";
import { readPurchasingWorkspace, runPurchasingCommand } from "./service";

type Fixture = Awaited<ReturnType<typeof seedSourcing>>;
const unavailable = { ok: false, error: "unavailable" };
const buy = (h: TestDb, who: NativeSessionRef, body: Record<string, unknown>) =>
  runPurchasingCommand(h.db, who, { requestId: randomUUID(), ...body }, signal());

async function approved(h: TestDb, f: Fixture, itemId: string, bom: ApprovedBomLine[]) {
  const releaseId = randomUUID();
  const createdBy = f.admin.userId;
  await h.db
    .insert(inventoryProductReleases)
    .values({ id: releaseId, itemId, createdBy, revision: "A" });
  const file = {
    releaseId,
    createdBy,
    sizeBytes: 32,
    state: "ready",
    sha256: "c".repeat(64),
    etag: "subcontract-integration",
  } as const;
  await h.db.insert(inventoryReleaseArtifacts).values([
    {
      ...file,
      kind: "pcbFabrication",
      objectKey: `${releaseId}/board`,
      name: "board.zip",
      contentType: "application/zip",
    },
    {
      ...file,
      kind: "manufacturingBom",
      objectKey: `${releaseId}/bom`,
      name: "bom.csv",
      contentType: "text/csv",
      bomEntries: bom.map(({ sku, quantity }) => ({ sku, quantity })),
    },
  ]);
  await h.db
    .update(inventoryProductReleases)
    .set({ status: "released", approvedAt: new Date(), approvedBy: createdBy, bom })
    .where(eq(inventoryProductReleases.id, releaseId));
  return releaseId;
}

async function prepareChild(h: TestDb, f: Fixture, vendorFurnished?: ApprovedBomLine) {
  const releaseId = await approved(h, f, f.lot.itemId, [
    { itemId: f.child.itemId, sku: "CONTROL-0132", name: "Controller", quantity: 1 },
    ...(vendorFurnished === undefined ? [] : [vendorFurnished]),
  ]);
  const parentRelease = await approved(h, f, f.parent.itemId, [
    {
      itemId: f.lot.itemId,
      sku: "MODULE-0132",
      name: "Module",
      quantity: 1,
      spec: {
        enteredQuantity: "1",
        enteredUnit: "each",
        stockUnit: "each",
        childReleaseId: releaseId,
        alternatives: [],
        optional: false,
        consumable: false,
        inherited: false,
        pieces: null,
      },
    },
  ]);
  const { buildId } = value(
    await runProductionCommand(
      h.db,
      f.admin,
      {
        ...f.source,
        type: "createBuild",
        requestId: randomUUID(),
        releaseId: parentRelease,
        quantity: 2,
        priority: "normal",
        dueDate: null,
        useTemplate: false,
        choices: [],
      },
      signal(),
    ),
  );
  const parent = value(await readProductionWorkspace(h.db, f.admin, { buildId }, signal()));
  const child = parent.detail?.children[0];
  assert(child !== undefined);
  expect(child).toMatchObject({ release: { id: releaseId }, quantity: 2, status: "planned" });
  return child;
}

async function prepareManufacturerOffer(h: TestDb, f: Fixture) {
  const scope = { siteId: f.source.siteId, itemId: f.lot.itemId };
  await h.db
    .update(inventoryPartProfiles)
    .set({
      flags: sql`jsonb_set(jsonb_set(${inventoryPartProfiles.flags}, '{purchasable}', 'true'), '{trackable}', 'true')`,
    })
    .where(eq(inventoryPartProfiles.itemId, f.lot.itemId));
  expect(
    await sourceCommand(h, f.admin, scope, {
      type: "saveManufacturer",
      id: null,
      expectedVersion: null,
      organizationId: f.manufacturer,
      partNumber: "MODULE-MFG",
    }),
  ).toEqual({ ok: true });
  const recorded = await sourcing(h, f.admin, scope);
  assert(recorded.ok);
  const [maker] = recorded.value.manufacturers;
  assert(maker !== undefined);
  expect(
    await sourceCommand(h, f.admin, scope, {
      type: "saveOffer",
      id: null,
      expectedVersion: null,
      supplierOrganizationId: f.manufacturer,
      manufacturerPartId: maker.id,
      partNumber: "MODULE-SUPPLY",
      packQuantity: 1,
      approved: true,
      available: true,
    }),
  ).toEqual({ ok: true });
  const offered = await sourcing(h, f.admin, scope);
  assert(offered.ok);
  const [offer] = offered.value.offers;
  assert(offer !== undefined);
  return offer.id;
}

async function purchase(
  h: TestDb,
  who: NativeSessionRef,
  siteId: string,
  orderId: string,
): Promise<PurchaseOrder> {
  const result = await readPurchasingWorkspace(h.db, who, { siteId, orderId }, signal());
  assert(result.ok);
  const order = result.value.orders.find(({ id }) => id === orderId);
  assert(order !== undefined);
  return order;
}

it("receives a subcontracted assembly into held WIP once while preserving scoped purchase and rejection history", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedSourcing(h);
    const { siteId } = f.source;
    const buyer = await createSourcingActor(h, f.admin, "Subcontract buyer", siteId, "buyer");
    const receiver = await createSourcingActor(
      h,
      f.admin,
      "Subcontract receiver",
      siteId,
      "warehouse_manager",
    );
    const outsider = await createSourcingActor(
      h,
      f.admin,
      "Remote receiver",
      f.remote.siteId,
      "warehouse_manager",
    );
    const offerId = await prepareManufacturerOffer(h, f);
    const child = await prepareChild(h, f);
    const supplierBinId = randomUUID();
    await h.db
      .insert(directoryLocations)
      .values({ id: supplierBinId, siteId, code: "EXT-QA-MAKER", name: "Subcontract bin" });
    expect(
      await runWarehouseCommand(
        h.db,
        f.admin,
        {
          type: "saveLocationPolicy",
          requestId: randomUUID(),
          locationId: supplierBinId,
          kind: "external",
        },
        signal(),
      ),
    ).toMatchObject({ ok: true });

    const draft = {
      type: "saveDraft",
      id: null,
      expectedVersion: null,
      siteId,
      locationId: f.recovery.locationId,
      supplierOrganizationId: f.manufacturer,
      reference: "PO-EXT-QA",
      expectedDate: null,
      lines: [{ offerId, packs: 2 }],
    } as const;
    const saved = await buy(h, buyer, draft);
    assert(saved.ok);
    const { id } = saved;
    const [line] = (await purchase(h, buyer, siteId, id)).lines;
    assert(line !== undefined);
    const link = {
      type: "linkSubcontract",
      requestId: randomUUID(),
      buildId: child.id,
      version: child.version,
      orderId: id,
      lineId: line.id,
      supplierBinId,
      companyMaterialIds: [],
    };
    expect(await runProductionCommand(h.db, buyer, link, signal())).toEqual(unavailable);
    expect(await runProductionCommand(h.db, f.admin, link, signal())).toMatchObject({ ok: true });
    const pinned = await purchase(h, buyer, siteId, id);
    expect(pinned.lines[0]).toMatchObject({ id: line.id, subcontracted: true });
    expect(pinned.lines[0]?.subcontractBuildId).toBeUndefined();
    expect((await purchase(h, f.admin, siteId, id)).lines[0]?.subcontractBuildId).toBe(child.id);
    expect(
      await buy(h, buyer, {
        ...draft,
        id,
        expectedVersion: pinned.version,
        reference: "EDIT-LINKED-PO",
      }),
    ).toEqual({ ok: false, error: "conflict" });
    expect(await buy(h, buyer, { type: "issue", id, expectedVersion: pinned.version })).toEqual({
      ok: true,
      id,
    });
    const [issued] = await h.db
      .select()
      .from(inventoryProductionBuilds)
      .where(eq(inventoryProductionBuilds.id, child.id));
    expect(issued).toMatchObject({ status: "issued", version: child.version + 2 });

    const open = await purchase(h, receiver, siteId, id);
    const accepted = {
      lineId: line.id,
      quantity: 1,
      lot: "EXT-LOT-01",
      serial: "EXT-MODULE-001",
      expiryDate: null,
      disposition: "accepted",
      reason: null,
    };
    const rejected = {
      ...accepted,
      lot: "EXT-REJECTED",
      serial: null,
      disposition: "rejected",
      reason: "Package damaged",
    };
    const receive = {
      type: "receive",
      requestId: randomUUID(),
      id,
      expectedVersion: open.version,
      supplierSlip: "SLIP-EXT-QA",
      lines: [accepted, rejected],
    };
    expect(await buy(h, outsider, receive)).toEqual(unavailable);
    expect(await buy(h, buyer, receive)).toEqual(unavailable);
    expect(await buy(h, receiver, { ...receive, lines: [{ ...accepted, lot: null }] })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await buy(h, receiver, receive)).toEqual({ ok: true, id });
    expect(await buy(h, receiver, receive)).toEqual({ ok: true, id });

    const partial = await purchase(h, receiver, siteId, id);
    expect(partial).toMatchObject({ status: "partial", subcontractCancellationBlocked: true });
    expect(partial.pricing).toBeUndefined();
    expect(partial.lines[0]).toMatchObject({ receivedUnits: 1, subcontracted: true });
    expect(partial.lines[0]?.subcontractBuildId).toBeUndefined();
    expect(partial.receipts).toHaveLength(1);
    const receiptLines = partial.receipts[0]?.lines ?? [];
    const posted = receiptLines.find(({ disposition }) => disposition === "accepted");
    assert(posted?.positionId != null);
    expect(posted).toMatchObject({ ...accepted, heldForRelease: true });
    expect(receiptLines.find(({ disposition }) => disposition === "rejected")).toMatchObject({
      ...rejected,
      positionId: null,
    });
    const [provenance] = await h.db
      .select()
      .from(inventorySubcontractReceipts)
      .where(eq(inventorySubcontractReceipts.receiptLineId, posted.id));
    assert(provenance !== undefined);
    expect(provenance).toMatchObject({
      orderId: id,
      buildId: child.id,
      positionId: posted.positionId,
    });
    const [wip] = await h.db
      .select()
      .from(inventoryProductionOutputs)
      .where(eq(inventoryProductionOutputs.id, provenance.outputId));
    expect(wip).toMatchObject({
      status: "wip",
      quantity: 1,
      releaseId: child.release.id,
      lot: accepted.lot,
      serials: [accepted.serial],
    });
    expect(await position(h, posted.positionId)).toMatchObject({
      locationId: f.recovery.locationId,
      state: "hold",
      onHand: 1,
      reserved: 0,
      lot: accepted.lot,
      serial: accepted.serial,
      buildOutputId: provenance.outputId,
    });
    const [history] = await h.db
      .select({ event: inventoryStockEvents })
      .from(purchaseReceiptLines)
      .innerJoin(inventoryStockEvents, eq(inventoryStockEvents.id, purchaseReceiptLines.eventId))
      .where(eq(purchaseReceiptLines.id, posted.id));
    expect(history?.event).toMatchObject({
      kind: "receipt",
      positionId: posted.positionId,
      onHandDelta: 1,
      incomingDelta: -1,
    });
    expect(await counts(h, f.lot.itemId)).toEqual({ onHand: 11, reserved: 4 });

    expect(
      await buy(h, receiver, {
        ...receive,
        requestId: randomUUID(),
        expectedVersion: partial.version,
        lines: [accepted],
      }),
    ).toEqual({ ok: false, error: "conflict" });
    expect(
      await h.db
        .select()
        .from(inventoryProductionOutputs)
        .where(eq(inventoryProductionOutputs.buildId, child.id)),
    ).toHaveLength(1);
    expect(await counts(h, f.lot.itemId)).toEqual({ onHand: 11, reserved: 4 });
    expect(
      await buy(h, buyer, {
        type: "cancel",
        id,
        expectedVersion: partial.version,
        reason: "Stop outstanding supplier quantities",
      }),
    ).toEqual({ ok: false, error: "conflict" });
    expect((await purchase(h, receiver, siteId, id)).version).toBe(partial.version);
  } finally {
    await h.close();
  }
});

it("dispatches and returns custody, releases held receipts only against exact supplied stock, and consumes the pinned lots in the parent", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedSourcing(h);
    const { siteId } = f.source;
    const buyer = await createSourcingActor(h, f.admin, "Outside order buyer", siteId, "buyer");
    const receiver = await createSourcingActor(
      h,
      f.admin,
      "Outside order receiver",
      siteId,
      "warehouse_manager",
    );
    const offerId = await prepareManufacturerOffer(h, f);
    const supplierPart = {
      id: randomUUID(),
      sku: "SUPPLIER-RESIN",
      name: "Supplier potting compound",
      revision: "A",
      kind: "component",
    } as const;
    await h.db.insert(inventoryItems).values(supplierPart);
    expect(await createLegacyPartProfile(h.db, supplierPart)).toBe(true);
    const child = await prepareChild(h, f, {
      itemId: supplierPart.id,
      sku: supplierPart.sku,
      name: supplierPart.name,
      quantity: 1,
    });
    assert(child.parentId !== null);
    const parentId = child.parentId;
    const supplierBinId = randomUUID();
    await h.db
      .insert(directoryLocations)
      .values({ id: supplierBinId, siteId, code: "EXT-QA", name: "Supplier custody" });
    expect(
      await runWarehouseCommand(
        h.db,
        f.admin,
        {
          type: "saveLocationPolicy",
          requestId: randomUUID(),
          locationId: supplierBinId,
          kind: "external",
        },
        signal(),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await runWarehouseCommand(
        h.db,
        f.admin,
        {
          type: "receive",
          requestId: randomUUID(),
          itemId: f.child.itemId,
          locationId: f.source.locationId,
          lot: "SUBCONTRACT-INPUT",
          serial: "SUBCONTRACT-SERIAL",
          quantity: 1,
          expiryDate: null,
          state: "available",
          ownerOrganizationId: null,
          incomingId: null,
        },
        signal(),
      ),
    ).toMatchObject({ ok: true });
    const built = async (buildId: string) => {
      const selected = value(
        await readProductionWorkspace(h.db, f.admin, { buildId }, signal()),
      ).detail;
      assert(selected !== null);
      return selected;
    };
    const production = (who: NativeSessionRef, intent: ProductionIntent) =>
      runProductionCommand(h.db, who, { requestId: randomUUID(), ...intent }, signal());
    const readChild = () => built(child.id);
    const readParent = () => built(parentId);
    const first = await readChild();
    const company = first.materials.find(({ part }) => part.id === f.child.itemId);
    assert(company !== undefined);
    const companyMaterialId = company.id;
    const draft = await buy(h, buyer, {
      type: "saveDraft",
      id: null,
      expectedVersion: null,
      siteId,
      locationId: f.recovery.locationId,
      supplierOrganizationId: f.manufacturer,
      reference: "PO-EXT-GENEALOGY",
      expectedDate: null,
      lines: [{ offerId, packs: 2 }],
    });
    assert(draft.ok);
    const orderId = draft.id;
    const po = () => purchase(h, buyer, siteId, orderId);
    const [line] = (await po()).lines;
    assert(line !== undefined);
    const lineId = line.id;
    value(
      await production(f.admin, {
        type: "linkSubcontract",
        buildId: child.id,
        version: first.version,
        orderId: orderId,
        lineId: lineId,
        supplierBinId,
        companyMaterialIds: [companyMaterialId],
      }),
    );
    expect(
      await buy(h, buyer, { type: "issue", id: orderId, expectedVersion: (await po()).version }),
    ).toMatchObject({ ok: true });

    async function dispatchAvailable() {
      value(
        await production(f.admin, {
          type: "autoAllocate",
          buildId: child.id,
          version: (await readChild()).version,
        }),
      );
      const allocated = await readChild();
      const material = allocated.materials.find(({ id }) => id === companyMaterialId);
      assert(material !== undefined);
      const selections = material.allocations.map(({ position: source, quantity }) => ({
        materialId: companyMaterialId,
        positionId: source.id,
        quantity,
      }));
      expect(selections.length).toBeGreaterThan(0);
      value(
        await production(f.admin, {
          type: "dispatchSubcontract",
          buildId: child.id,
          version: allocated.version,
          allocations: selections,
          reason: "Dispatch company components",
        }),
      );
    }
    await dispatchAvailable();
    const shipped = await readChild();
    expect(shipped.subcontract?.custody).toHaveLength(2);
    const returned = shipped.subcontract?.custody.find(
      ({ serial }) => serial === "SUBCONTRACT-SERIAL",
    );
    assert(returned !== undefined);
    const [parcel] = await h.db
      .select()
      .from(inventorySubcontractDispatches)
      .where(eq(inventorySubcontractDispatches.id, returned.id));
    assert(parcel !== undefined);
    expect(parcel.vendorPositionId).toBe(parcel.sourcePositionId);
    expect(await position(h, parcel.vendorPositionId)).toMatchObject({
      locationId: supplierBinId,
      onHand: 1,
      reserved: 1,
    });
    expect(
      await buy(h, buyer, {
        type: "cancel",
        id: orderId,
        expectedVersion: (await po()).version,
        reason: "Custody still outstanding",
      }),
    ).toEqual({ ok: false, error: "conflict" });
    value(
      await production(f.admin, {
        type: "returnSubcontractMaterial",
        buildId: child.id,
        version: shipped.version,
        dispatchId: returned.id,
        quantity: 1,
        reason: "Replace shipping carton",
      }),
    );
    expect(await position(h, parcel.sourcePositionId)).toMatchObject({
      locationId: f.source.locationId,
      onHand: 1,
      reserved: 0,
    });
    await dispatchAvailable();

    async function receive(serial: string, lot: string) {
      expect(
        await buy(h, receiver, {
          type: "receive",
          id: orderId,
          expectedVersion: (await po()).version,
          supplierSlip: lot,
          lines: [
            {
              lineId: lineId,
              quantity: 1,
              lot,
              serial,
              expiryDate: null,
              disposition: "accepted",
              reason: null,
            },
          ],
        }),
      ).toMatchObject({ ok: true });
      const received = await readChild();
      const output = received.outputs.find(({ serials }) => serials.includes(serial));
      assert(output !== undefined);
      expect(output.status).toBe("wip");
      return { output, received };
    }
    const held = await receive("VENDOR-A-001", "VENDOR-LOT-ONE");
    const [origin] = await h.db
      .select()
      .from(inventorySubcontractReceipts)
      .where(eq(inventorySubcontractReceipts.outputId, held.output.id));
    assert(origin !== undefined);
    expect(
      await runWarehouseCommand(
        h.db,
        receiver,
        {
          type: "setPositionState",
          requestId: randomUUID(),
          id: origin.positionId,
          state: "available",
          quantity: 1,
        },
        signal(),
      ),
    ).toMatchObject({ ok: false });
    value(
      await production(f.admin, {
        type: "autoAllocate",
        buildId: parentId,
        version: (await readParent()).version,
      }),
    );
    expect((await readParent()).materials[0]?.allocated).toBe(0);
    const promote = (outputId: string, version: number) =>
      ({
        type: "releaseSubcontractOutput",
        buildId: child.id,
        version,
        outputId,
        reason: "Supplier lot accepted",
      }) as const;
    expect(await production(receiver, promote(held.output.id, held.received.version))).toEqual(
      unavailable,
    );
    const balanceBefore = await counts(h, f.lot.itemId);
    value(await production(f.admin, promote(held.output.id, held.received.version)));
    expect(await counts(h, f.lot.itemId)).toEqual(balanceBefore);
    expect(await position(h, origin.positionId)).toMatchObject({
      state: "available",
      buildOutputId: held.output.id,
      locationId: f.recovery.locationId,
    });
    const second = await receive("VENDOR-A-002", "VENDOR-LOT-TWO");
    value(await production(f.admin, promote(second.output.id, second.received.version)));
    expect((await readChild()).status).toBe("closed");
    expect((await po()).status).toBe("received");
    expect(
      await h.db
        .select()
        .from(inventorySubcontractReturns)
        .where(eq(inventorySubcontractReturns.dispatchId, returned.id)),
    ).toHaveLength(1);
    const consumption = await h.db.select().from(inventorySubcontractConsumptions);
    expect(consumption).toHaveLength(2);
    expect(consumption.every(({ dispatchId }) => dispatchId !== returned.id)).toBe(true);
    expect(await counts(h, supplierPart.id)).toEqual({ onHand: 0, reserved: 0 });

    value(
      await production(f.admin, {
        type: "autoAllocate",
        buildId: parentId,
        version: (await readParent()).version,
      }),
    );
    expect((await readParent()).materials[0]?.allocated).toBe(2);
    value(
      await production(f.admin, {
        type: "issue",
        buildId: parentId,
        version: (await readParent()).version,
      }),
    );
    value(
      await production(f.admin, {
        type: "startBatch",
        buildId: parentId,
        version: (await readParent()).version,
        quantity: 2,
      }),
    );
    const building = await readParent();
    const [batch] = building.outputs;
    assert(batch !== undefined);
    value(
      await production(f.admin, {
        type: "finalizeBatch",
        buildId: parentId,
        version: building.version,
        outputId: batch.id,
        disposition: "completed",
        lot: "PARENT-SUBCONTRACTED",
        serials: [],
        reason: "Parent built from released vendor stock",
      }),
    );
    const completed = await readParent();
    expect(completed.status).toBe("closed");
    expect(completed.outputs[0]?.inputs.map(({ position: input }) => input.serial).sort()).toEqual([
      "VENDOR-A-001",
      "VENDOR-A-002",
    ]);
    expect(
      completed.outputs[0]?.inputs.every(({ position: input }) => input.sourceBuildId === child.id),
    ).toBe(true);
    expect(await position(h, f.lot.positionId)).toMatchObject({
      onHand: 10,
      reserved: 4,
      buildOutputId: null,
    });
  } finally {
    await h.close();
  }
});

it("upgrades populated 0138 stock and an approved production pin without rewriting incumbent records", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 139);
    const f = await seedSourcing(h);
    const releaseId = await approved(h, f, f.lot.itemId, [
      { itemId: f.child.itemId, sku: "CONTROL-0132", name: "Control", quantity: 1 },
    ]);
    await h.db.insert(inventoryProductionBuilds).values({
      ...f.source,
      releaseId,
      itemId: f.lot.itemId,
      stockUnit: "each",
      quantity: 3,
      trackable: false,
      priority: "normal",
      createdBy: f.admin.userId,
    });
    const priorBuilds = await h.db.select().from(inventoryProductionBuilds);
    const before = await incumbentRows(h);
    const earlier = await ledger(h);
    expect(earlier).toHaveLength(139);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    const upgraded = await ledger(h);
    const manifest = await readCanonicalMigrations(canonicalFolder, signal());
    assert(manifest.ok);
    expect(upgraded).toHaveLength(manifest.value.length);
    expect(manifest.value[139]?.tag).toBe("0139_inventory_subcontract_manufacturing");
    expect(upgraded[139]?.hash).toBe(manifest.value[139]?.hash);
    expect(upgraded.slice(0, 139)).toEqual(earlier);
    expect(await h.db.select().from(inventoryProductionBuilds)).toEqual(priorBuilds);
    expect(await incumbentRows(h)).toEqual(before);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    expect(await ledger(h)).toEqual(upgraded);
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
