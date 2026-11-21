import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
} from "@/db/migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "@/db/migrationAdmissionSource";
import { deals, organizations, pipelines, sessions, stages, users } from "@/db/schema";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { readReturnsWorkspace } from "@/features/inventory/returns/reads";
import {
  returnCases,
  returnHistory,
  returnLines,
  returnReceipts,
} from "@/features/inventory/returns/schema";
import { runReturnCommand } from "@/features/inventory/returns/service";
import { readSalesWorkspace } from "@/features/inventory/sales/reads";
import { salesShipmentLines, salesShipments } from "@/features/inventory/sales/schema";
import { runSalesCommand } from "@/features/inventory/sales/service";
import { createSourcingActor, setRole } from "@/features/inventory/sourcing/sourcing.test-helpers";
import {
  actor,
  incumbentRows,
  seedStructures,
  signal,
} from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { executeLocationsCommand, readLocationsDirectory } from "@/features/locations/service";
import { makeTestDb, type TestDb } from "@/test/db";
import type { AssetIntent, AssetRecord, AssetResult } from "./contracts";
import { assetEvents, assetRecords } from "./schema";
import { readAssetsWorkspace, runAssetCommand } from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;

function succeeded(result: AssetResult) {
  if (!result.ok) throw new Error(`Expected asset operation to succeed, got ${result.error}`);
  return result;
}

function record(result: AssetResult, id: string | null = null) {
  const { focusId, value } = succeeded(result);
  const found = value.records.find((entry) => entry.id === (id ?? focusId));
  assert(found !== undefined);
  return found;
}

function read(h: TestDb, who: NativeSessionRef): Promise<AssetResult> {
  return readAssetsWorkspace(h.db, who, signal());
}

function run(
  h: TestDb,
  who: NativeSessionRef,
  intent: AssetIntent,
  requestId = randomUUID(),
): Promise<AssetResult> {
  return runAssetCommand(h.db, who, { ...intent, requestId }, signal());
}

function create(siteId: string, code: string): Extract<AssetIntent, { type: "create" }> {
  return {
    type: "create",
    siteId,
    code,
    name: code,
    description: null,
    categoryId: null,
    tags: [],
    fieldValues: {},
    tracking: "individual",
    serial: null,
    modelId: null,
    locationId: null,
    openingQuantity: 0,
  };
}

function version({ id, version }: AssetRecord) {
  return { assetId: id, version };
}

async function seedLegacyReturn(h: TestDb, f: Awaited<ReturnType<typeof seedStructures>>) {
  const { admin, source, remote, lot } = f;
  const orgId = randomUUID();
  const pipelineId = randomUUID();
  const stageId = randomUUID();
  const dealId = randomUUID();
  await h.db.insert(organizations).values({
    id: orgId,
    ownerId: admin.userId,
    name: "Existing engineering customer",
    visibilityLevel: "owner",
  });
  await h.db.insert(pipelines).values({ id: pipelineId, name: "Existing product sales" });
  await h.db.insert(stages).values({ id: stageId, pipelineId, name: "Fulfillment" });
  await h.db.insert(deals).values({
    id: dealId,
    orgId,
    pipelineId,
    stageId,
    ownerId: admin.userId,
    visibilityLevel: "owner",
    title: "Prior instrument shipment",
    currency: "EUR",
  });
  const order = await runSalesCommand(
    h.db,
    admin,
    {
      type: "saveDraft",
      requestId: randomUUID(),
      orderId: null,
      version: null,
      dealId,
      siteId: source.siteId,
      reference: "SO-BEFORE-ASSETS",
      dueDate: null,
      recipient: "Instrumentation receiving",
      address: "1 Equipment Lane\n10115 Berlin\nDE",
      currency: "EUR",
      charges: [],
      lines: [{ itemId: lot.itemId, quantity: 2, unitPrice: "48.50", note: null }],
    },
    signal(),
  );
  assert(order.ok);
  const orderId = order.id;
  const detail = async () => {
    const read = await readSalesWorkspace(h.db, admin, { orderId }, signal());
    assert(read.ok && read.value.detail !== null);
    return read.value.detail;
  };
  const sale = async (input: Record<string, unknown>) => {
    const result = await runSalesCommand(
      h.db,
      admin,
      {
        orderId,
        version: (await detail()).version,
        requestId: randomUUID(),
        ...input,
      },
      signal(),
    );
    expect(result).toMatchObject({ ok: true });
    return result;
  };
  await sale({ type: "issueOrder" });
  await sale({ type: "autoAllocate" });
  const allocation = (await detail()).lines[0]?.allocations[0];
  assert(allocation !== undefined);
  const posted = await sale({
    type: "createShipment",
    reference: "SHIP-BEFORE-ASSETS",
    lines: [{ allocationId: allocation.id, quantity: 1 }],
  });
  assert(posted.ok && posted.shipmentId !== undefined);
  const shipmentId = posted.shipmentId;
  const packed = (await detail()).shipments.find(({ id }) => id === shipmentId)?.lines[0];
  assert(packed !== undefined);
  await sale({
    type: "checkShipmentLine",
    shipmentId,
    shipmentLineId: packed.id,
    checked: true,
    scan: "MODULE-LOT-01",
  });
  await sale({
    type: "postShipment",
    shipmentId,
    carrier: "Local delivery",
    tracking: "PRIOR-0142",
    shippedOn: "2026-11-15",
  });
  const draft = await runReturnCommand(
    h.db,
    admin,
    {
      type: "saveDraft",
      requestId: randomUUID(),
      caseId: null,
      version: null,
      shipmentId,
      siteId: remote.siteId,
      reference: "RMA-BEFORE-ASSETS",
      note: "Open prior return remains quarantined.",
      charges: [],
      lines: [{ shipmentLineId: packed.id, quantity: 1, reason: "Damaged housing" }],
    },
    signal(),
  );
  assert(draft.ok);
  const caseId = draft.id;
  const returnDetail = async () => {
    const result = await readReturnsWorkspace(h.db, admin, { caseId }, signal());
    assert(result.ok && result.value.detail !== null);
    return result.value.detail;
  };
  const changeReturn = async (input: Record<string, unknown>) => {
    const result = await runReturnCommand(
      h.db,
      admin,
      {
        caseId,
        version: (await returnDetail()).version,
        requestId: randomUUID(),
        ...input,
      },
      signal(),
    );
    expect(result).toMatchObject({ ok: true });
  };
  await changeReturn({ type: "issue" });
  const line = (await returnDetail()).lines[0];
  assert(line !== undefined);
  await changeReturn({
    type: "receive",
    lineId: line.id,
    locationId: remote.locationId,
    quantity: 1,
    serial: null,
    condition: "damaged",
    note: "Keep in quarantine pending inspection.",
  });
  expect((await returnDetail()).lines[0]?.receipts[0]).toMatchObject({ physical: "quarantine" });
  return returnDetail;
}

async function legacySnapshot(h: TestDb) {
  const [stock, sites, locations, shipments, packing, cases, lines, receipts, history] =
    await Promise.all([
      incumbentRows(h),
      h.db.select().from(directorySites).orderBy(asc(directorySites.id)),
      h.db.select().from(directoryLocations).orderBy(asc(directoryLocations.id)),
      h.db.select().from(salesShipments).orderBy(asc(salesShipments.id)),
      h.db.select().from(salesShipmentLines).orderBy(asc(salesShipmentLines.id)),
      h.db.select().from(returnCases).orderBy(asc(returnCases.id)),
      h.db.select().from(returnLines).orderBy(asc(returnLines.id)),
      h.db.select().from(returnReceipts).orderBy(asc(returnReceipts.id)),
      h.db.select().from(returnHistory).orderBy(asc(returnHistory.id)),
    ]);
  return { stock, sites, locations, shipments, packing, cases, lines, receipts, history };
}

it("upgrades populated 0142 stock, reservations and quarantined return custody through 0143", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 143);
    const f = await seedStructures(h);
    const returnDetail = await seedLegacyReturn(h, f);
    const previousReturn = await returnDetail();
    const before = await legacySnapshot(h);
    const oldLedger = await ledger(h);
    expect(oldLedger).toHaveLength(143);
    expect(before.receipts).toHaveLength(1);
    expect(before.stock.allocations).toHaveLength(1);
    expect(before.stock.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serial: "PARENT-001" }),
        expect.objectContaining({
          lot: "MODULE-LOT-01",
          site_id: f.source.siteId,
          on_hand: 9,
          reserved: 5,
        }),
      ]),
    );

    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    const canonical = await readCanonicalMigrations(canonicalFolder, signal());
    assert(canonical.ok);
    const applied = await ledger(h);
    expect(applied.slice(0, 143)).toEqual(oldLedger);
    expect(applied).toHaveLength(canonical.value.length);
    expect(canonical.value[143]?.tag).toBe("0143_asset_register");
    expect(applied[143]?.hash).toBe(canonical.value[143]?.hash);
    expect(await returnDetail()).toEqual(previousReturn);
    expect(await legacySnapshot(h)).toEqual(before);
    expect(succeeded(await read(h, f.admin)).value.records).toEqual([]);

    const landed = record(
      await run(h, f.admin, {
        ...create(f.remote.siteId, "CALIBRATION-METER-01"),
        serial: "CAL-METER-0001",
        locationId: f.remote.locationId,
      }),
    );
    expect(landed).toMatchObject({
      tracking: "individual",
      locationId: f.remote.locationId,
    });
    expect(await legacySnapshot(h)).toEqual(before);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    expect(await ledger(h)).toEqual(applied);
    expect(record(await read(h, f.admin), landed.id)).toEqual(landed);
    expect(await legacySnapshot(h)).toEqual(before);
  } finally {
    await h.close();
  }
});

it("registers stable fleet units and gates typed metadata, stale writes and replay by asset site", async () => {
  const h = await makeTestDb();
  try {
    const { admin, source, recovery, remote } = await seedStructures(h);
    const manager = await createSourcingActor(
      h,
      admin,
      "Asset manager",
      source.siteId,
      "asset_manager",
    );
    await setRole(h, admin, manager, remote.siteId, "warehouse_manager");
    const viewer = await createSourcingActor(
      h,
      admin,
      "Asset reader",
      source.siteId,
      "asset_viewer",
    );
    const directory = await readLocationsDirectory(h.db, viewer, signal());
    assert(directory.ok);
    const scoped = succeeded(await read(h, viewer));
    expect(directory.value.directory.locations).toHaveLength(scoped.value.locations.length);
    expect(directory.value.directory.locations).toEqual(
      expect.arrayContaining(scoped.value.locations),
    );
    expect(directory.value.directory.sites.map(({ id }) => id)).toEqual([source.siteId]);
    expect(directory.value.managedSiteIds).toEqual([]);
    const warehouse = await createSourcingActor(
      h,
      admin,
      "Warehouse manager",
      source.siteId,
      "warehouse_manager",
    );
    expect(
      await executeLocationsCommand(
        h.db,
        admin,
        {
          type: "setGrant",
          requestId: randomUUID(),
          siteId: source.siteId,
          userId: warehouse.userId,
          role: "manager",
        },
        signal(),
      ),
    ).toMatchObject({ ok: true });
    const guest = await actor(h, "Projects guest");
    await h.db.update(users).set({ projectsGuestOnly: true }).where(eq(users.id, guest.userId));
    const expired = await actor(h, "Expired member");
    await h.db
      .update(sessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(sessions.id, expired.sessionId));

    const remoteAsset = record(await run(h, admin, create(remote.siteId, "QA-REMOTE-UNIT")));
    expect(await read(h, guest)).toEqual(unavailable);
    expect(await read(h, expired)).toEqual(unavailable);
    expect(succeeded(await read(h, warehouse)).value).toEqual({
      sites: [],
      locations: [],
      categories: [],
      models: [],
      records: [],
    });
    expect(await run(h, warehouse, create(source.siteId, "QA-NOT-A-WAREHOUSE-ASSET"))).toEqual(
      unavailable,
    );
    expect(await run(h, manager, create(remote.siteId, "QA-WRONG-SITE"))).toEqual(unavailable);
    expect(
      await run(h, manager, {
        type: "note",
        ...version(remoteAsset),
        reason: "Cannot write a hidden record",
      }),
    ).toEqual(unavailable);

    const precision = randomUUID();
    const calibration = randomUUID();
    const portable = randomUUID();
    const input: Extract<AssetIntent, { type: "saveCategory" }> = {
      type: "saveCategory",
      siteId: source.siteId,
      categoryId: null,
      version: null,
      name: "Test instruments",
      fields: [
        {
          id: precision,
          label: "Precision class",
          type: "choice",
          required: true,
          options: ["A", "B"],
          defaultValue: "A",
        },
        {
          id: calibration,
          label: "Calibration due",
          type: "date",
          required: true,
          options: [],
          defaultValue: "2027-01-10",
        },
        {
          id: portable,
          label: "Portable",
          type: "boolean",
          required: true,
          options: [],
          defaultValue: false,
        },
      ],
    };
    expect(await run(h, viewer, input)).toEqual(unavailable);
    const category = succeeded(await run(h, manager, input)).value.categories.find(
      ({ name }) => name === input.name,
    );
    assert(category !== undefined);

    const template: Extract<AssetIntent, { type: "saveModel" }> = {
      type: "saveModel",
      siteId: source.siteId,
      modelId: null,
      version: null,
      code: "METER-A",
      name: "Precision meter",
      description: "Bench instrumentation",
      categoryId: category.id,
      tags: ["calibration", "QA"],
      fieldValues: { [precision]: "B" },
    };
    const invalid = await run(h, manager, {
      ...template,
      fieldValues: { [calibration]: "2027-02-30" },
    });
    expect(invalid).toEqual({ ok: false, error: "invalid" });
    const model = succeeded(await run(h, manager, template)).value.models.find(
      ({ code }) => code === template.code,
    );
    assert(model !== undefined);
    expect(model.fieldValues).toEqual({
      [precision]: "B",
      [calibration]: "2027-01-10",
      [portable]: false,
    });

    const fleetInput = {
      type: "createFleet",
      siteId: source.siteId,
      modelId: model.id,
      locationId: source.locationId,
      units: [
        { code: "METER-001", serial: "MTR-A-1" },
        { code: "METER-002", serial: "MTR-A-2" },
      ],
    } satisfies AssetIntent;
    const fleetRequest = randomUUID();
    const built = succeeded(await run(h, manager, fleetInput, fleetRequest));
    const first = built.value.records.find(({ code }) => code === "METER-001");
    const second = built.value.records.find(({ code }) => code === "METER-002");
    assert(first !== undefined && second !== undefined);
    expect(first.id).not.toBe(second.id);
    expect(built.focusId).toBe(first.id);
    for (const unit of [first, second]) {
      expect(unit).toMatchObject({
        tracking: "individual",
        modelId: model.id,
        categoryId: category.id,
        fieldValues: model.fieldValues,
        tags: template.tags,
        events: [{ kind: "created", actor: "Asset manager" }],
      });
    }
    expect(succeeded(await run(h, manager, fleetInput, fleetRequest)).focusId).toBe(first.id);
    expect(
      await run(
        h,
        manager,
        { ...fleetInput, units: [{ code: "METER-003", serial: null }] },
        fleetRequest,
      ),
    ).toEqual({ ok: false, error: "conflict" });
    expect(succeeded(await read(h, viewer)).value).toMatchObject({
      sites: [{ id: source.siteId, canManage: false }],
      records: [
        expect.objectContaining({ id: first.id }),
        expect.objectContaining({ id: second.id }),
      ],
    });
    const managerView = succeeded(await read(h, manager)).value;
    expect(managerView.sites).toMatchObject([{ id: source.siteId, canManage: true }]);
    expect(managerView.locations.every(({ siteId }) => siteId === source.siteId)).toBe(true);
    expect(managerView.records.map(({ id }) => id)).not.toContain(remoteAsset.id);

    const change = {
      type: "update",
      ...version(first),
      code: first.code,
      name: "Individually calibrated meter",
      description: first.description,
      categoryId: first.categoryId,
      tags: first.tags,
      fieldValues: { ...first.fieldValues, [calibration]: "2027-02-20" },
      serial: "MTR-A-1",
      modelId: null,
    } satisfies AssetIntent;
    expect(await run(h, viewer, change)).toEqual(unavailable);
    const revised = record(await run(h, manager, change));
    expect(revised).toMatchObject({
      id: first.id,
      modelId: null,
      version: first.version + 1,
      fieldValues: change.fieldValues,
      events: [{ kind: "updated" }, { kind: "created" }],
    });
    expect(await run(h, manager, change)).toEqual({ ok: false, error: "stale" });
    expect(record(await read(h, manager), second.id)).toEqual(second);

    const relocate = {
      type: "move",
      ...version(second),
      locationId: recovery.locationId,
      reason: "Move the calibrated unit to the verification bench",
    } satisfies AssetIntent;
    expect(await run(h, manager, { ...relocate, locationId: remote.locationId })).toEqual(
      unavailable,
    );
    expect(record(await run(h, manager, relocate))).toMatchObject({
      id: second.id,
      serial: "MTR-A-2",
      modelId: model.id,
      locationId: recovery.locationId,
      events: [
        { kind: "moved", fromLocationId: source.locationId, locationId: recovery.locationId },
        { kind: "created" },
      ],
    });

    await setRole(h, admin, manager, source.siteId, "asset_manager", false);
    expect(await run(h, manager, fleetInput, fleetRequest)).toEqual(unavailable);
    expect(succeeded(await read(h, manager)).value.records).toEqual([]);
  } finally {
    await h.close();
  }
});

function setLocationArchive(h: TestDb, admin: NativeSessionRef, id: string, archived: boolean) {
  return executeLocationsCommand(
    h.db,
    admin,
    {
      type: "setLocationArchived",
      requestId: randomUUID(),
      id,
      archived,
    },
    signal(),
  );
}

function setSiteArchive(h: TestDb, admin: NativeSessionRef, id: string, archived: boolean) {
  return executeLocationsCommand(
    h.db,
    admin,
    {
      type: "setSiteArchived",
      requestId: randomUUID(),
      id,
      archived,
    },
    signal(),
  );
}

it("conserves pooled equipment through exact bin movements and protects the shared directory", async () => {
  const h = await makeTestDb();
  try {
    const { admin, source, recovery, remote } = await seedStructures(h);
    const before = await incumbentRows(h);
    const operator = await createSourcingActor(
      h,
      admin,
      "Equipment owner",
      source.siteId,
      "asset_manager",
    );
    const pool = record(
      await run(h, operator, {
        ...create(source.siteId, "QA-CONSUMABLE-CONNECTORS"),
        tracking: "consumable_pool",
        locationId: source.locationId,
        openingQuantity: 20,
      }),
    );
    const returnable = record(
      await run(h, operator, {
        ...create(source.siteId, "QA-RETURNABLE-LEADS"),
        tracking: "returnable_pool",
        locationId: source.locationId,
        openingQuantity: 8,
      }),
    );
    const move = {
      type: "changePool",
      ...version(pool),
      operation: "move",
      locationId: source.locationId,
      toLocationId: recovery.locationId,
      quantity: 6,
      reason: "Restock the assembly bench",
    } satisfies AssetIntent;
    expect(await run(h, operator, { ...move, toLocationId: remote.locationId })).toEqual(
      unavailable,
    );
    expect(await run(h, operator, { ...move, quantity: 21 })).toEqual({
      ok: false,
      error: "stock",
    });
    const moved = record(await run(h, operator, move));
    expect(moved).toMatchObject({
      balances: expect.arrayContaining([
        { locationId: source.locationId, quantity: 14 },
        { locationId: recovery.locationId, quantity: 6 },
      ]),
      events: [
        {
          kind: "moved",
          fromLocationId: source.locationId,
          locationId: recovery.locationId,
          quantity: 6,
        },
        { kind: "created" },
      ],
    });
    expect(await setLocationArchive(h, admin, recovery.locationId, true)).toEqual({
      ok: false,
      error: "activeAssets",
    });
    const consume = {
      type: "changePool",
      ...version(moved),
      operation: "consume",
      locationId: recovery.locationId,
      toLocationId: null,
      quantity: 2,
      reason: "Used two samples in the lab",
    } satisfies AssetIntent;
    expect(
      await run(h, operator, {
        ...consume,
        ...version(returnable),
        locationId: source.locationId,
      }),
    ).toEqual({ ok: false, error: "invalid" });
    const consumeRequest = randomUUID();
    const used = record(await run(h, operator, consume, consumeRequest));
    expect(record(await run(h, operator, consume, consumeRequest))).toEqual(used);

    const [left, right] = await Promise.all([
      run(h, operator, { type: "note", ...version(used), reason: "Count checked by shift team" }),
      run(h, operator, {
        type: "note",
        ...version(used),
        reason: "Verified inventory at assembly bench",
      }),
    ]);
    expect([left, right].filter((result) => result.ok)).toHaveLength(1);
    expect([left, right].filter((result) => !result.ok)).toEqual([{ ok: false, error: "stale" }]);
    const current = record(await read(h, operator), pool.id);
    const finished = record(
      await run(h, operator, {
        ...consume,
        ...version(current),
        operation: "adjust",
        quantity: 3,
        reason: "Physical count found three intact connectors",
      }),
    );
    expect(finished).toMatchObject({
      id: pool.id,
      balances: expect.arrayContaining([
        { locationId: source.locationId, quantity: 14 },
        { locationId: recovery.locationId, quantity: 3 },
      ]),
      events: [
        { kind: "adjusted", locationId: recovery.locationId, quantity: -1 },
        { kind: "note" },
        { kind: "consumed", locationId: recovery.locationId, quantity: -2 },
        { kind: "moved" },
        { kind: "created" },
      ],
    });
    const restocked = record(
      await run(h, operator, {
        ...consume,
        ...version(finished),
        operation: "restock",
        locationId: source.locationId,
        quantity: 2,
        reason: "Received two replacement samples",
      }),
    );
    expect(restocked).toMatchObject({
      balances: expect.arrayContaining([
        { locationId: source.locationId, quantity: 16 },
        { locationId: recovery.locationId, quantity: 3 },
      ]),
      events: [
        { kind: "restocked", locationId: source.locationId, quantity: 2 },
        ...finished.events,
      ],
    });
    const archived = record(
      await run(h, operator, {
        type: "setArchive",
        ...version(restocked),
        archived: true,
        reason: "Pause registered laboratory use",
      }),
    );
    expect(archived.archivedAt).not.toBeNull();
    expect(await setLocationArchive(h, admin, recovery.locationId, true)).toMatchObject({
      ok: true,
    });
    const reinstate = {
      type: "setArchive",
      ...version(archived),
      archived: false,
      reason: "Return to laboratory use",
    } satisfies AssetIntent;
    expect(await run(h, operator, reinstate)).toEqual({ ok: false, error: "state" });
    expect(await setLocationArchive(h, admin, recovery.locationId, false)).toMatchObject({
      ok: true,
    });
    const restored = record(await run(h, operator, reinstate));
    expect(restored).toMatchObject({
      id: pool.id,
      archivedAt: null,
      events: [{ kind: "reinstated" }, { kind: "archived" }, ...restocked.events],
    });
    const [latestEvent] = restored.events;
    assert(latestEvent);
    await expect(
      h.db
        .update(assetEvents)
        .set({ reason: "Rewrite history" })
        .where(eq(assetEvents.id, latestEvent.id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      h.db
        .update(assetRecords)
        .set({
          tracking: "returnable_pool",
          version: restored.version + 1,
        })
        .where(eq(assetRecords.id, restored.id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      h.db
        .update(assetRecords)
        .set({
          name: "Changed without history",
          version: restored.version + 1,
        })
        .where(eq(assetRecords.id, restored.id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });

    const siteId = randomUUID();
    await h.db
      .insert(directorySites)
      .values({ id: siteId, code: "EQUIPMENT", name: "Equipment only" });
    const unassigned = record(await run(h, admin, create(siteId, "UNASSIGNED-METER")));
    expect(await setSiteArchive(h, admin, siteId, true)).toEqual({
      ok: false,
      error: "activeAssets",
    });
    const retired = record(
      await run(h, admin, {
        type: "setArchive",
        ...version(unassigned),
        archived: true,
        reason: "Register retired",
      }),
    );
    expect(await setSiteArchive(h, admin, siteId, true)).toMatchObject({ ok: true });
    expect(await setSiteArchive(h, admin, siteId, false)).toMatchObject({ ok: true });
    expect(record(await read(h, admin), retired.id)).toEqual(retired);
    await h.db.delete(sessions).where(eq(sessions.userId, operator.userId));
    await h.db.delete(users).where(eq(users.id, operator.userId));
    const anonymized = record(await read(h, admin), restored.id);
    expect(anonymized.events).toEqual(restored.events.map((event) => ({ ...event, actor: "" })));
    expect(await incumbentRows(h)).toEqual(before);
  } finally {
    await h.close();
  }
});
