import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
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
import { createSourcingActor, setRole } from "@/features/inventory/sourcing/sourcing.test-helpers";
import {
  incumbentRows,
  seedStructures,
  signal,
} from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { makeTestDb, type TestDb } from "@/test/db";
import type { AssetIntent, AssetRecord, AssetsWorkspace } from "../contracts";
import type { CustodyIntent } from "../custody/contracts";
import {
  assetCustodians,
  assetCustodyHistory,
  assetCustodyHoldings,
  assetCustodyReceipts,
} from "../custody/schema";
import { runAssetCustodyCommand } from "../custody/service";
import { assetBalances, assetEvents, assetRecords } from "../schema";
import { readAssetsWorkspace, runAssetCommand } from "../service";
import type { Kit, KitIntent, KitMemberInput, KitResult } from "./contracts";
import { assetKitCheckoutLines, assetKitDefinitions, assetKitReceipts } from "./schema";
import { runKitCommand } from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;
const held = { ok: false, error: "held" } as const;

type Seed = Awaited<ReturnType<typeof seedStructures>>;
type Endpoint = Seed["source"];

function apply(h: TestDb, who: NativeSessionRef, intent: KitIntent, requestId = randomUUID()) {
  return runKitCommand(h.db, who, { ...intent, requestId }, signal());
}

function asset(h: TestDb, who: NativeSessionRef, intent: AssetIntent) {
  return runAssetCommand(h.db, who, { ...intent, requestId: randomUUID() }, signal());
}

function custody(h: TestDb, who: NativeSessionRef, intent: CustodyIntent) {
  return runAssetCustodyCommand(h.db, who, { ...intent, requestId: randomUUID() }, signal());
}

function selected<T>(found: T | undefined): T {
  assert(found !== undefined);
  return found;
}

function accepted(result: KitResult) {
  assert(result.ok);
  return { value: result.value, kit: kitAt(result.value, result.kitId) };
}

function kitAt(value: AssetsWorkspace, id: string) {
  return selected(value.kits?.records.find((entry) => entry.id === id));
}

function recordAt(value: AssetsWorkspace, id: string) {
  return selected(value.records.find((entry) => entry.id === id));
}

function kitTarget(kit: Kit) {
  return { siteId: kit.siteId, kitId: kit.id, version: kit.version };
}

function kitDraft(at: Endpoint, code: string, lines: KitMemberInput[] = []) {
  return {
    ...at,
    type: "saveKit",
    code,
    name: code,
    kitId: null,
    version: null,
    lines,
    note: null,
  } satisfies KitIntent;
}

function assetMetadata(siteId: string, code: string) {
  return {
    siteId,
    code,
    name: code,
    categoryId: null,
    description: null,
    tags: [],
    fieldValues: {},
  };
}

async function createAsset(
  h: TestDb,
  who: NativeSessionRef,
  at: Endpoint,
  code: string,
  options: Partial<
    Pick<
      Extract<AssetIntent, { type: "create" }>,
      "tracking" | "serial" | "modelId" | "openingQuantity"
    >
  > = {},
) {
  const result = await asset(h, who, {
    ...assetMetadata(at.siteId, code),
    ...at,
    type: "create",
    tracking: "individual",
    serial: code,
    modelId: null,
    openingQuantity: 0,
    ...options,
  });
  assert(result.ok && result.focusId !== null);
  return recordAt(result.value, result.focusId);
}

function directCustody(record: AssetRecord, holder: string) {
  return {
    type: "assign",
    assetId: record.id,
    siteId: record.siteId,
    version: record.version,
    custodianId: holder,
    quantity: 1,
    condition: "good",
    locationId: null,
    note: null,
  } satisfies CustodyIntent;
}

async function seedIncumbentCustody(h: TestDb, { admin, source }: Seed) {
  // Only 0145 tables are available before upgrading, so seed the prior versioned
  // Asset and custody rows without running a new read projection that includes Kits.
  const assetId = randomUUID();
  const custodianId = randomUUID();
  const holdingId = randomUUID();
  const eventId = randomUUID();
  const at = new Date("2026-11-12T09:30:00.000Z");
  const { siteId, locationId } = source;
  const custodianName = "Incumbent Equipment Team";
  const note = "Issued before the upgrade";
  const actorId = admin.userId;
  await h.db.transaction(async (tx) => {
    await tx.insert(assetRecords).values({
      id: assetId,
      siteId,
      code: "INCUMBENT-145",
      codeKey: "incumbent-145",
      name: "Existing calibrated meter",
      tracking: "individual",
      version: 1,
      serial: "CAL-145-A",
      serialKey: "cal-145-a",
      locationId,
    });
    await tx.insert(assetEvents).values({
      assetId,
      siteId,
      actorId,
      version: 1,
      kind: "created",
      locationId,
    });
    await tx.insert(assetCustodians).values({
      id: custodianId,
      siteId,
      name: custodianName,
      kind: "non_login",
      version: 1,
    });
    await tx.insert(assetCustodyHoldings).values({
      id: holdingId,
      siteId,
      assetId,
      tracking: "individual",
      custodianId,
      custodianName,
      quantity: 1,
      sourceLocationId: locationId,
      locationId,
      condition: "good",
      assignedAt: at,
    });
    await tx.update(assetRecords).set({ version: 2 }).where(eq(assetRecords.id, assetId));
    await tx.insert(assetEvents).values({
      id: eventId,
      assetId,
      siteId,
      actorId,
      version: 2,
      kind: "updated",
      at,
      reason: note,
      fromLocationId: locationId,
      locationId,
      quantity: 1,
    });
    await tx.insert(assetCustodyHistory).values({
      id: eventId,
      assetId,
      siteId,
      version: 2,
      action: "assign",
      holdingId,
      toCustodianId: custodianId,
      toCustodianName: custodianName,
      quantity: 1,
      sourceLocationId: locationId,
      locationId,
      condition: "good",
      note,
    });
    await tx.insert(assetCustodyReceipts).values({
      actorId,
      siteId,
      requestId: randomUUID(),
      fingerprint: "a".repeat(64),
      outcomes: [],
    });
  });
  return { assetId, holdingId, eventId };
}

async function incumbentSnapshot(h: TestDb) {
  const [stock, assets, history, custodians, holdings, custodyHistory, receipts] =
    await Promise.all([
      incumbentRows(h),
      h.db.select().from(assetRecords).orderBy(asc(assetRecords.id)),
      h.db.select().from(assetEvents).orderBy(asc(assetEvents.version)),
      h.db.select().from(assetCustodians).orderBy(asc(assetCustodians.id)),
      h.db.select().from(assetCustodyHoldings).orderBy(asc(assetCustodyHoldings.id)),
      h.db.select().from(assetCustodyHistory).orderBy(asc(assetCustodyHistory.id)),
      h.db.select().from(assetCustodyReceipts).orderBy(asc(assetCustodyReceipts.requestId)),
    ]);
  return { stock, assets, history, custodians, holdings, custodyHistory, receipts };
}

it("preserves equipment history, an active custody holding and warehouse allocations through 0146", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 146);
    const seed = await seedStructures(h);
    const { admin, source } = seed;
    const { assetId, holdingId, eventId } = await seedIncumbentCustody(h, seed);
    const before = await incumbentSnapshot(h);
    const oldLedger = await ledger(h);
    expect(oldLedger).toHaveLength(146);
    expect(before.stock.allocations).toMatchObject([{ quantity: 4 }]);
    expect(before.history).toMatchObject([{ version: 1 }, { id: eventId, version: 2 }]);
    expect(before.holdings).toMatchObject([{ id: holdingId, assetId }]);

    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    const canonical = await readCanonicalMigrations(canonicalFolder, signal());
    assert(canonical.ok);
    const applied = await ledger(h);
    expect(canonical.value[146]?.tag).toBe("0146_asset_kits");
    expect(applied[146]?.hash).toBe(canonical.value[146]?.hash);
    expect(applied.slice(0, 146)).toEqual(oldLedger);
    expect(applied).toHaveLength(canonical.value.length);
    expect(await incumbentSnapshot(h)).toEqual(before);

    const workspace = await readAssetsWorkspace(h.db, admin, signal());
    assert(workspace.ok);
    expect(workspace.value.kits?.records).toEqual([]);
    expect(workspace.value.custody?.holdings).toMatchObject([{ id: holdingId, assetId }]);
    expect(recordAt(workspace.value, assetId).events.map(({ id }) => id)).toContain(eventId);
    const member: KitMemberInput = {
      mode: "individual",
      assetId,
      modelId: null,
      quantity: 1,
      sourceLocationId: null,
    };
    expect(await apply(h, admin, kitDraft(source, "PROTECT-HELD", [member]))).toEqual(held);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    expect(await ledger(h)).toEqual(applied);
    expect(await incumbentSnapshot(h)).toEqual(before);
  } finally {
    await h.close();
  }
});

async function fixture(h: TestDb, { admin, source, recovery }: Seed) {
  const manager = await createSourcingActor(
    h,
    admin,
    "Kit operator",
    source.siteId,
    "asset_manager",
  );
  const model = await asset(h, manager, {
    type: "saveModel",
    modelId: null,
    version: null,
    ...assetMetadata(source.siteId, "METER-MODEL"),
  });
  assert(model.ok);
  const modelId = selected(model.value.models.find(({ code }) => code === "METER-MODEL")).id;
  const original = await createAsset(h, manager, source, "METER-ORIGINAL", { modelId });
  const alternate = await createAsset(h, manager, source, "METER-ALTERNATE", { modelId });
  const fixed = await createAsset(h, manager, recovery, "METER-FIXED", { modelId });
  const shared = await createAsset(h, manager, source, "LEADS-POOL", {
    tracking: "returnable_pool",
    openingQuantity: 20,
    serial: null,
  });
  const consumable = await createAsset(h, manager, source, "FERRULE-POOL", {
    tracking: "consumable_pool",
    openingQuantity: 10,
    serial: null,
  });
  const recipient = await custody(h, manager, {
    type: "saveCustodian",
    siteId: source.siteId,
    custodianId: null,
    version: null,
    staffId: null,
    name: "Service team",
    active: true,
  });
  assert(recipient.ok);
  const custodianId = selected(recipient.value.custody?.custodians[0]).id;
  const meters: KitMemberInput[] = [
    { mode: "model", modelId, assetId: original.id, quantity: 1, sourceLocationId: null },
    { mode: "individual", modelId: null, assetId: fixed.id, quantity: 1, sourceLocationId: null },
  ];
  const slice: KitMemberInput = {
    mode: "returnable_pool",
    modelId: null,
    assetId: shared.id,
    quantity: 4,
    sourceLocationId: source.locationId,
  };
  const supply: KitMemberInput = {
    mode: "consumable_pool",
    modelId: null,
    assetId: consumable.id,
    quantity: 3,
    sourceLocationId: source.locationId,
  };
  return {
    manager,
    original,
    alternate,
    fixed,
    shared,
    consumable,
    modelId,
    custodianId,
    meters,
    slice,
    supply,
  };
}

async function expectRegisterProtection(
  h: TestDb,
  who: NativeSessionRef,
  packed: AssetRecord,
  to: Endpoint,
  custodianId: string,
) {
  const target = { assetId: packed.id, version: packed.version };
  expect(
    await asset(h, who, {
      ...target,
      type: "move",
      locationId: to.locationId,
      reason: "Bypass kit relocation",
    }),
  ).toEqual({ ok: false, error: "state" });
  expect(
    await asset(h, who, {
      ...target,
      type: "setArchive",
      archived: true,
      reason: "Bypass kit availability",
    }),
  ).toEqual({ ok: false, error: "state" });
  expect(await custody(h, who, directCustody(packed, custodianId))).toEqual(held);
}

async function checkOutWithRetry(h: TestDb, f: Awaited<ReturnType<typeof fixture>>, kit: Kit) {
  const slot = selected(kit.lines.find(({ mode }) => mode === "model"));
  const intent = {
    ...kitTarget(kit),
    type: "checkoutKit",
    custodianId: f.custodianId,
    note: "Issue the spare",
    replacements: [{ lineId: slot.id, assetId: f.alternate.id }],
  } satisfies KitIntent;
  const wrong = { ...intent, replacements: [{ lineId: slot.id, assetId: f.fixed.id }] };
  expect(await apply(h, f.manager, wrong)).toEqual({ ok: false, error: "conflict" });
  const requestId = randomUUID();
  const [first, second] = await Promise.all([
    apply(h, f.manager, intent, requestId),
    apply(h, f.manager, intent, requestId),
  ]);
  expect(second).toEqual(first);
  expect(
    await h.db.select().from(assetKitReceipts).where(eq(assetKitReceipts.requestId, requestId)),
  ).toHaveLength(1);
  expect(await apply(h, f.manager, { ...intent, note: "Changed request" }, requestId)).toEqual({
    ok: false,
    error: "conflict",
  });
  return accepted(first);
}

async function returnKitParts(
  h: TestDb,
  manager: NativeSessionRef,
  issued: ReturnType<typeof accepted>,
) {
  const checkout = selected(
    issued.value.kits.checkouts.find(({ kitId }) => kitId === issued.kit.id),
  );
  const pool = selected(
    checkout.lines.find(({ mode, quantity }) => mode === "returnable_pool" && quantity === 4),
  );
  const supply = selected(checkout.lines.find(({ mode }) => mode === "consumable_pool"));
  const model = selected(checkout.lines.find(({ mode }) => mode === "model"));
  const settling = {
    type: "returnKit",
    checkoutId: checkout.id,
    condition: "good",
    note: "Partial return",
  } as const;
  expect(
    await apply(h, manager, {
      ...settling,
      ...kitTarget(issued.kit),
      lines: [{ lineId: model.id, returned: 0, consumed: 1 }],
    }),
  ).toEqual({ ok: false, error: "invalid" });
  const partial = accepted(
    await apply(h, manager, {
      ...settling,
      ...kitTarget(issued.kit),
      lines: [
        { lineId: pool.id, returned: 2, consumed: 0 },
        { lineId: supply.id, returned: 1, consumed: 2 },
      ],
    }),
  );
  const active = selected(partial.value.kits.checkouts.find(({ id }) => id === checkout.id));
  expect(active.closedAt).toBeNull();
  expect(active.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: pool.id, returned: 2, consumed: 0 }),
      expect.objectContaining({ id: supply.id, returned: 1, consumed: 2 }),
    ]),
  );
  const returned = active.lines.flatMap(({ id, quantity, returned, consumed }) => {
    const pending = quantity - returned - consumed;
    return pending === 0 ? [] : [{ lineId: id, returned: pending, consumed: 0 }];
  });
  return accepted(
    await apply(h, manager, {
      ...settling,
      ...kitTarget(partial.kit),
      lines: returned,
      note: "Final return",
    }),
  );
}

it("relocates and issues exact kit slices, preserves replacements and protects both ledgers", async () => {
  const h = await makeTestDb();
  try {
    const seed = await seedStructures(h);
    const { admin, source, recovery, remote } = seed;
    const f = await fixture(h, seed);
    const viewer = await createSourcingActor(h, admin, "Kit reader", source.siteId, "asset_viewer");
    const remoteOnly = await createSourcingActor(
      h,
      admin,
      "Other site",
      remote.siteId,
      "asset_manager",
    );
    const draft = kitDraft(source, "KIT-A", [
      ...f.meters,
      f.slice,
      { ...f.slice, quantity: 2 },
      f.supply,
    ]);
    expect(await apply(h, viewer, draft)).toEqual(unavailable);
    expect(await apply(h, remoteOnly, draft)).toEqual(unavailable);
    const a = accepted(await apply(h, f.manager, draft));
    const b = accepted(await apply(h, f.manager, kitDraft(source, "KIT-B", [f.slice])));
    expect(recordAt(b.value, f.shared.id)).toMatchObject({
      version: f.shared.version + 2,
      balances: [{ locationId: source.locationId, quantity: 10 }],
    });
    await expectRegisterProtection(
      h,
      f.manager,
      recordAt(b.value, f.fixed.id),
      recovery,
      f.custodianId,
    );
    const poolArchive = {
      type: "setArchive",
      assetId: f.shared.id,
      version: f.shared.version + 2,
      archived: true,
      reason: "Kit slices must stay available",
    } satisfies AssetIntent;
    expect(await asset(h, f.manager, poolArchive)).toEqual({ ok: false, error: "state" });

    const move = {
      type: "moveKit",
      ...kitTarget(a.kit),
      locationId: recovery.locationId,
      note: null,
    } satisfies KitIntent;
    expect(await apply(h, f.manager, { ...move, locationId: remote.locationId })).toEqual(
      unavailable,
    );
    const moveRequest = randomUUID();
    const moved = accepted(await apply(h, f.manager, move, moveRequest));
    expect(await apply(h, f.manager, move)).toEqual({ ok: false, error: "stale" });
    expect(recordAt(moved.value, f.original.id)).toMatchObject({ locationId: recovery.locationId });
    const sharedAfterMove = recordAt(moved.value, f.shared.id);
    expect(sharedAfterMove).toMatchObject({
      version: f.shared.version + 3,
      balances: [{ locationId: source.locationId, quantity: 10 }],
    });
    expect(sharedAfterMove.events[0]).toMatchObject({ kind: "moved", quantity: 6 });
    expect(kitAt(moved.value, b.kit.id)).toEqual(b.kit);

    const own = await readAssetsWorkspace(h.db, viewer, signal());
    const elsewhere = await readAssetsWorkspace(h.db, remoteOnly, signal());
    assert(own.ok && elsewhere.ok);
    expect(own.value.kits?.records.map(({ id }) => id)).toEqual([a.kit.id, b.kit.id]);
    expect(elsewhere.value.kits?.records).toEqual([]);

    const issued = await checkOutWithRetry(h, f, moved.kit);
    await verifyIssue(h, f, issued, recovery);
    expect(kitAt(issued.value, b.kit.id)).toEqual(b.kit);
    expect(await apply(h, f.manager, { ...move, ...kitTarget(issued.kit) })).toEqual(held);
    expect(await apply(h, f.manager, { ...draft, ...kitTarget(issued.kit) })).toEqual(held);
    const returned = await returnKitParts(h, f.manager, issued);
    await verifyClosedHistory(h, f, returned, a.kit, b.kit, source, recovery);
    await setRole(h, admin, f.manager, source.siteId, "asset_manager", false);
    expect(await apply(h, f.manager, move, moveRequest)).toEqual(unavailable);
  } finally {
    await h.close();
  }
});

async function verifyIssue(
  h: TestDb,
  f: Awaited<ReturnType<typeof fixture>>,
  issued: ReturnType<typeof accepted>,
  bin: Endpoint,
) {
  const checkout = selected(
    issued.value.kits.checkouts.find(({ kitId }) => kitId === issued.kit.id),
  );
  expect(checkout).toMatchObject({
    definitionVersion: 1,
    closedAt: null,
    custodianName: "Service team",
  });
  expect(checkout.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        mode: "model",
        requestedAssetId: f.original.id,
        assetId: f.alternate.id,
        modelId: f.modelId,
        serial: f.alternate.code,
        sourceLocationId: bin.locationId,
      }),
      expect.objectContaining({
        mode: "individual",
        requestedAssetId: f.fixed.id,
        assetId: f.fixed.id,
        modelId: null,
        serial: f.fixed.code,
      }),
    ]),
  );
  expect(recordAt(issued.value, f.alternate.id)).toMatchObject({ locationId: bin.locationId });
  const fixed = recordAt(issued.value, f.fixed.id);
  expect(
    await custody(h, f.manager, {
      type: "return",
      siteId: fixed.siteId,
      assetId: fixed.id,
      version: fixed.version,
      holdingId: selected(checkout.lines.find(({ assetId }) => assetId === fixed.id)).id,
      condition: "good",
      quantity: 1,
      locationId: null,
      note: null,
    }),
  ).toEqual(held);
  expect(
    await h.db
      .select()
      .from(assetKitCheckoutLines)
      .where(eq(assetKitCheckoutLines.checkoutId, checkout.id)),
  ).toHaveLength(5);
}

async function verifyClosedHistory(
  h: TestDb,
  f: Awaited<ReturnType<typeof fixture>>,
  returned: ReturnType<typeof accepted>,
  original: Kit,
  other: Kit,
  source: Endpoint,
  recovery: Endpoint,
) {
  const closed = selected(
    returned.value.kits.checkouts.find(({ kitId }) => kitId === returned.kit.id),
  );
  expect(closed.closedAt).not.toBeNull();
  expect(closed.lines.find(({ mode }) => mode === "consumable_pool")).toMatchObject({
    quantity: 3,
    returned: 1,
    consumed: 2,
  });
  expect(returned.value.kits.returns).toHaveLength(2);
  expect(
    await apply(h, f.manager, {
      type: "checkoutKit",
      ...kitTarget(returned.kit),
      custodianId: f.custodianId,
      replacements: [],
      note: null,
    }),
  ).toEqual({ ok: false, error: "quantity" });
  const repacked = accepted(
    await apply(h, f.manager, {
      ...kitDraft(recovery, original.code),
      ...kitTarget(returned.kit),
      name: "Kit after field work",
    }),
  );
  expect(repacked.kit).toMatchObject({ definitionVersion: 2, lines: [] });
  expect(kitAt(repacked.value, other.id)).toEqual(other);
  expect(repacked.value.kits.checkouts).toEqual(returned.value.kits.checkouts);
  expect(repacked.value.kits.returns).toEqual(returned.value.kits.returns);
  const [balances, definitions] = await Promise.all([
    h.db.select().from(assetBalances).where(eq(assetBalances.assetId, f.shared.id)),
    h.db
      .select()
      .from(assetKitDefinitions)
      .where(eq(assetKitDefinitions.kitId, returned.kit.id))
      .orderBy(asc(assetKitDefinitions.definitionVersion)),
  ]);
  expect(balances).toHaveLength(2);
  expect(balances).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ locationId: source.locationId, quantity: 10 }),
      expect.objectContaining({ locationId: recovery.locationId, quantity: 6 }),
    ]),
  );
  expect(definitions).toMatchObject([{ definitionVersion: 1 }, { definitionVersion: 2 }]);
  const loose = recordAt(repacked.value, f.consumable.id);
  expect(loose).toMatchObject({
    balances: expect.arrayContaining([
      { locationId: source.locationId, quantity: 7 },
      { locationId: recovery.locationId, quantity: 1 },
    ]),
  });
}

it("rolls back kit and Asset state together when return history cannot be written", async () => {
  const h = await makeTestDb();
  try {
    const { admin, source } = await seedStructures(h);
    const equipment = await createAsset(h, admin, source, "KIT-RETURN-ROLLBACK", {
      tracking: "consumable_pool",
      openingQuantity: 10,
      serial: null,
    });
    const recipient = await custody(h, admin, {
      type: "saveCustodian",
      siteId: source.siteId,
      custodianId: null,
      version: null,
      staffId: null,
      name: "Return rollback custodian",
      active: true,
    });
    assert(recipient.ok);
    const custodianId = selected(recipient.value.custody?.custodians[0]).id;
    const ready = accepted(
      await apply(
        h,
        admin,
        kitDraft(source, "RETURN-ROLLBACK", [
          {
            mode: "consumable_pool",
            assetId: equipment.id,
            modelId: null,
            sourceLocationId: source.locationId,
            quantity: 3,
          },
        ]),
      ),
    );
    const issued = accepted(
      await apply(h, admin, {
        ...kitTarget(ready.kit),
        type: "checkoutKit",
        custodianId,
        replacements: [],
        note: null,
      }),
    );
    const checkout = selected(issued.value.kits.checkouts[0]);
    const line = selected(checkout.lines[0]);
    const input = {
      ...kitTarget(issued.kit),
      type: "returnKit",
      checkoutId: checkout.id,
      condition: "good",
      note: "One unused and two consumed",
      lines: [{ lineId: line.id, returned: 1, consumed: 2 }],
    } satisfies KitIntent;
    const requestId = randomUUID();
    const before = await readAssetsWorkspace(h.db, admin, signal());

    await h.db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE FUNCTION test_reject_kit_return() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM asset_kit_checkouts checkout
            JOIN asset_kit_checkout_lines line ON line.checkout_id = checkout.id
            JOIN asset_kit_members member ON member.kit_id = checkout.kit_id AND member.id = line.id
            JOIN asset_records asset ON asset.id = line.asset_id
            JOIN asset_events event ON event.asset_id = asset.id AND event.version = asset.version
            WHERE checkout.id = NEW.checkout_id AND checkout.closed_at IS NOT NULL
              AND line.returned = 1 AND line.consumed = 2 AND member.packed_quantity = 1
              AND event.kind = 'updated' AND event.quantity = 3
          ) THEN
            RAISE EXCEPTION 'Return history reached before kit and Asset changes';
          END IF;
          RAISE EXCEPTION 'Test rejected kit return insert' USING ERRCODE = '23514';
        END;
        $$;
      `);
      await tx.execute(sql`
        CREATE TRIGGER test_reject_kit_return BEFORE INSERT ON asset_kit_returns
        FOR EACH ROW EXECUTE FUNCTION test_reject_kit_return()
      `);
    });
    try {
      await expect(apply(h, admin, input, requestId)).rejects.toMatchObject({
        cause: { code: "23514", message: "Test rejected kit return insert" },
      });
    } finally {
      await h.db.transaction(async (tx) => {
        await tx.execute(sql`DROP TRIGGER test_reject_kit_return ON asset_kit_returns`);
        await tx.execute(sql`DROP FUNCTION test_reject_kit_return()`);
      });
    }

    expect(await readAssetsWorkspace(h.db, admin, signal())).toEqual(before);
    const receipts = () =>
      h.db.select().from(assetKitReceipts).where(eq(assetKitReceipts.requestId, requestId));
    expect(await receipts()).toEqual([]);
    const retry = accepted(await apply(h, admin, input, requestId));
    expect(retry.kit.lines).toMatchObject([{ id: line.id, packedQuantity: 1 }]);
    expect(retry.value.kits.checkouts[0]).toMatchObject({
      id: checkout.id,
      closedAt: expect.any(String),
      lines: [{ id: line.id, returned: 1, consumed: 2 }],
    });
    expect(retry.value.kits.returns).toHaveLength(1);
    expect(recordAt(retry.value, equipment.id)).toMatchObject({
      version: equipment.version + 3,
      balances: [{ locationId: source.locationId, quantity: 7 }],
    });
    expect(await receipts()).toHaveLength(1);
  } finally {
    await h.close();
  }
});
