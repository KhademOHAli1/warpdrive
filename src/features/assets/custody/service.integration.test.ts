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
import { users } from "@/db/schema";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { createSourcingActor, setRole } from "@/features/inventory/sourcing/sourcing.test-helpers";
import {
  actor,
  incumbentRows,
  seedStructures,
  signal,
} from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { operationsSiteGrants } from "@/features/operations-access/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { assetCommissioningHandoffs } from "../commissioning/schema";
import { runCommissionAssetCommand } from "../commissioning/service";
import type { AssetIntent, AssetsWorkspace } from "../contracts";
import { assetBalances, assetEvents, assetRecords } from "../schema";
import { readAssetsWorkspace, runAssetCommand } from "../service";
import type { CustodyIntent, CustodyResult } from "./contracts";
import { assetCustodyHistory, assetCustodyHoldings, assetCustodyReceipts } from "./schema";
import { runAssetCustodyCommand } from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;
const handover = { condition: "good", locationId: null, note: null } as const;

function custodySucceeded(result: CustodyResult) {
  if (!result.ok) throw new Error(`Expected custody success, received ${result.error}`);
  return result;
}

function apply(h: TestDb, who: NativeSessionRef, intent: CustodyIntent, requestId = randomUUID()) {
  return runAssetCustodyCommand(h.db, who, { ...intent, requestId }, signal());
}

function changeAsset(h: TestDb, who: NativeSessionRef, intent: AssetIntent) {
  return runAssetCommand(h.db, who, { ...intent, requestId: randomUUID() }, signal());
}

function record(workspace: AssetsWorkspace, id: string) {
  const found = workspace.records.find((row) => row.id === id);
  assert(found !== undefined);
  return found;
}

async function workspace(h: TestDb, who: NativeSessionRef) {
  const result = await readAssetsWorkspace(h.db, who, signal());
  assert(result.ok);
  assert(result.value.custody !== undefined);
  return { ...result.value, custody: result.value.custody };
}

async function createAsset(
  h: TestDb,
  who: NativeSessionRef,
  at: { siteId: string; locationId: string },
  code: string,
  poolQuantity = 0,
) {
  const result = await changeAsset(h, who, {
    ...at,
    type: "create",
    code,
    name: code,
    description: null,
    categoryId: null,
    tags: [],
    fieldValues: {},
    tracking: poolQuantity > 0 ? "returnable_pool" : "individual",
    serial: poolQuantity > 0 ? null : code,
    modelId: null,
    openingQuantity: poolQuantity,
  });
  assert(result.ok && result.focusId !== null);
  return record(result.value, result.focusId);
}

function newCustodian(siteId: string, name: string | null, staffId: string | null = null) {
  return {
    type: "saveCustodian",
    siteId,
    custodianId: null,
    version: null,
    name,
    staffId,
    active: true,
  } as const;
}

async function addExternal(h: TestDb, manager: NativeSessionRef, siteId: string, name: string) {
  const { value } = custodySucceeded(await apply(h, manager, newCustodian(siteId, name)));
  const found = value.custody.custodians.find((row) => row.siteId === siteId && row.name === name);
  assert(found !== undefined);
  return found;
}

async function priorAssetSnapshot(h: TestDb, assetId: string) {
  const [assets, history, handoffs] = await Promise.all([
    h.db.select().from(assetRecords).where(eq(assetRecords.id, assetId)),
    h.db
      .select()
      .from(assetEvents)
      .where(eq(assetEvents.assetId, assetId))
      .orderBy(asc(assetEvents.version)),
    h.db
      .select()
      .from(assetCommissioningHandoffs)
      .where(eq(assetCommissioningHandoffs.assetId, assetId)),
  ]);
  return { assets, history, handoffs };
}

it("preserves commissioned equipment, warehouse allocations and history through the populated 0145 upgrade", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 145);
    const { admin, source, parent } = await seedStructures(h);
    const prior = await runCommissionAssetCommand(
      h.db,
      admin,
      {
        requestId: randomUUID(),
        positionId: parent.positionId,
        ...source,
        serial: "PARENT-001",
        lot: null,
        code: "COMMISSIONED-0144",
        name: "Incumbent calibrated fixture",
        reason: "Commissioned before enabling custody.",
      },
      signal(),
    );
    assert(prior.ok);
    const before = await priorAssetSnapshot(h, prior.assetId);
    const stock = await incumbentRows(h);
    const prefix = await ledger(h);
    expect(prefix).toHaveLength(145);
    expect(before.history).toMatchObject([{ kind: "created", version: 1 }]);
    expect(before.handoffs).toMatchObject([{ id: prior.handoffId, serial: "PARENT-001" }]);
    expect(stock.allocations).toMatchObject([{ quantity: 4 }]);
    expect(stock.positions).toContainEqual(
      expect.objectContaining({
        id: parent.positionId,
        serial: "PARENT-001",
        on_hand: 0,
      }),
    );

    expect(await applyMigrations(h.db, signal(), canonicalFolder)).toMatchObject({ ok: true });
    const canonical = await readCanonicalMigrations(canonicalFolder, signal());
    assert(canonical.ok);
    const current = await ledger(h);
    expect(canonical.value[145]?.tag).toBe("0145_asset_custody");
    expect(current).toHaveLength(canonical.value.length);
    expect(current.slice(0, 145)).toEqual(prefix);
    expect(current[145]?.hash).toBe(canonical.value[145]?.hash);
    expect(await priorAssetSnapshot(h, prior.assetId)).toEqual(before);
    expect(await incumbentRows(h)).toEqual(stock);
    expect((await workspace(h, admin)).custody.holdings).toEqual([]);

    const external = await addExternal(h, admin, source.siteId, "Commissioned equipment operator");
    const assigned = custodySucceeded(
      await apply(h, admin, {
        ...handover,
        type: "assign",
        siteId: source.siteId,
        assetId: prior.assetId,
        version: 1,
        custodianId: external.id,
        quantity: 1,
      }),
    );
    expect(record(assigned.value, prior.assetId)).toMatchObject({
      version: 2,
      tracking: "individual",
      serial: "PARENT-001",
      locationId: source.locationId,
    });
    expect(assigned.value.custody.holdings).toMatchObject([{ assetId: prior.assetId }]);
    expect(await applyMigrations(h.db, signal(), canonicalFolder)).toMatchObject({ ok: true });
    expect(await ledger(h)).toEqual(current);
    expect((await priorAssetSnapshot(h, prior.assetId)).handoffs).toEqual(before.handoffs);
    expect(await incumbentRows(h)).toEqual(stock);
  } finally {
    await h.close();
  }
});

it("scopes custody, protects held assets and records exact mixed bulk and individual handovers", async () => {
  const h = await makeTestDb();
  try {
    const { admin, source, recovery, remote } = await seedStructures(h);
    const { siteId } = source;
    const manager = await createSourcingActor(h, admin, "Custody manager", siteId, "asset_manager");
    const viewer = await createSourcingActor(h, admin, "Custody viewer", siteId, "asset_viewer");
    const foreignViewer = await createSourcingActor(
      h,
      admin,
      "Remote reader",
      remote.siteId,
      "asset_viewer",
    );
    const staff = await actor(h, "Staff without an Assets role");
    const held = await createAsset(h, manager, source, "CUSTODY-HELD");
    const free = await createAsset(h, manager, source, "CUSTODY-FREE");
    const pool = await createAsset(h, manager, source, "CUSTODY-POOL", 2);
    const foreign = await createAsset(h, admin, remote, "CUSTODY-FOREIGN");
    expect(await apply(h, viewer, newCustodian(siteId, "Denied"))).toEqual(unavailable);
    expect(await apply(h, manager, newCustodian(remote.siteId, "Denied"))).toEqual(unavailable);

    const roster = custodySucceeded(
      await apply(h, manager, newCustodian(siteId, null, staff.userId)),
    );
    const employee = roster.value.custody.custodians.find(
      ({ staffId }) => staffId === staff.userId,
    );
    assert(employee !== undefined);
    expect(employee).toMatchObject({ kind: "staff", name: "Staff without an Assets role" });
    const usersBefore = (await h.db.select({ id: users.id }).from(users)).length;
    const external = await addExternal(h, manager, siteId, "External technician");
    expect(external).toMatchObject({ kind: "non_login", staffId: null });
    expect(await h.db.select({ id: users.id }).from(users)).toHaveLength(usersBefore);
    expect(
      await h.db
        .select()
        .from(operationsSiteGrants)
        .where(eq(operationsSiteGrants.userId, staff.userId)),
    ).toEqual([]);

    const note = "Private custodian instructions";
    const noted = custodySucceeded(
      await apply(h, manager, {
        type: "noteCustodian",
        siteId,
        custodianId: external.id,
        note,
      }),
    );
    expect(noted.value.custody.notes).toMatchObject([
      { custodianId: external.id, note, actor: "Custody manager" },
    ]);
    const assigned = custodySucceeded(
      await apply(h, manager, {
        ...handover,
        type: "assign",
        siteId,
        assetId: held.id,
        version: held.version,
        custodianId: employee.id,
        quantity: 1,
        locationId: recovery.locationId,
      }),
    );
    const sourceHolding = assigned.value.custody.holdings[0];
    assert(sourceHolding !== undefined);
    expect(sourceHolding).toMatchObject({
      assetId: held.id,
      custodianId: employee.id,
      sourceLocationId: source.locationId,
      locationId: recovery.locationId,
    });
    const observed = await workspace(h, viewer);
    expect(observed.custody.holdings.map(({ id }) => id)).toEqual([sourceHolding.id]);
    expect(observed.custody.events).toMatchObject([{ action: "assign", assetId: held.id }]);
    expect(observed.custody).toMatchObject({ custodians: [], staff: [], notes: [] });
    expect((await workspace(h, foreignViewer)).custody.holdings).toEqual([]);
    expect(await readAssetsWorkspace(h.db, staff, signal())).toMatchObject({
      ok: true,
      value: { sites: [], records: [] },
    });

    const heldVersion = record(assigned.value, held.id).version;
    await verifyHeldRegisterGuards(h, manager, held.id, heldVersion, recovery.locationId);
    expect(
      await apply(h, manager, {
        ...handover,
        type: "return",
        siteId,
        assetId: held.id,
        version: heldVersion,
        holdingId: sourceHolding.id,
        locationId: remote.locationId,
        quantity: 1,
      }),
    ).toEqual(unavailable);

    const batch: Extract<CustodyIntent, { type: "bulkAssign" }> = {
      ...handover,
      type: "bulkAssign",
      siteId,
      custodianId: external.id,
      assets: [
        { assetId: free.id, version: free.version },
        { assetId: held.id, version: heldVersion },
        { assetId: pool.id, version: pool.version },
        { assetId: foreign.id, version: foreign.version },
      ],
    };
    const requestId = randomUUID();
    const [first, replay] = await Promise.all([
      apply(h, manager, batch, requestId),
      apply(h, manager, batch, requestId),
    ]);
    const outcome = custodySucceeded(first);
    expect(replay).toEqual(first);
    expect(outcome.outcomes).toEqual([
      { assetId: free.id, ok: true },
      { assetId: held.id, ok: false, error: "held" },
      { assetId: pool.id, ok: false, error: "ineligible" },
      { assetId: foreign.id, ok: false, error: "unavailable" },
    ]);
    expect(
      await h.db
        .select()
        .from(assetCustodyReceipts)
        .where(eq(assetCustodyReceipts.requestId, requestId)),
    ).toHaveLength(1);
    expect(await apply(h, manager, { ...batch, note: "Different request" }, requestId)).toEqual({
      ok: false,
      error: "conflict",
    });

    await h.db.update(users).set({ isActive: false }).where(eq(users.id, staff.userId));
    const returned = await handBackToStorage(h, manager, {
      siteId,
      assetId: held.id,
      version: heldVersion,
      holdingId: sourceHolding.id,
      custodianId: external.id,
      locationId: recovery.locationId,
    });
    expect(returned.custody.events.filter(({ assetId }) => assetId === held.id)).toMatchObject([
      { action: "return", fromCustodianName: "External technician", condition: "worn" },
      {
        action: "transfer",
        fromCustodianName: "Staff without an Assets role",
        toCustodianName: "External technician",
      },
      { action: "assign", toCustodianName: "Staff without an Assets role" },
    ]);
    expect(record(returned, held.id)).toMatchObject({
      locationId: recovery.locationId,
      version: heldVersion + 2,
    });
    expect(
      await apply(h, manager, {
        ...handover,
        type: "assign",
        siteId,
        assetId: held.id,
        version: heldVersion,
        quantity: 1,
        custodianId: external.id,
      }),
    ).toEqual({ ok: false, error: "stale" });
    expect(
      await apply(h, manager, {
        ...handover,
        type: "assign",
        siteId,
        assetId: held.id,
        version: heldVersion + 2,
        quantity: 1,
        custodianId: employee.id,
      }),
    ).toEqual(unavailable);

    const released = custodySucceeded(
      await apply(h, manager, {
        ...handover,
        type: "bulkReturn",
        siteId,
        assets: [
          { assetId: free.id, version: free.version + 1 },
          { assetId: foreign.id, version: foreign.version },
        ],
      }),
    );
    expect(released.outcomes).toEqual([
      { assetId: free.id, ok: true },
      { assetId: foreign.id, ok: false, error: "unavailable" },
    ]);
    expect(released.value.custody.holdings).toEqual([]);
    await verifyLinkedHistory(h, held.id, manager.userId);
    await setRole(h, admin, manager, siteId, "asset_manager", false);
    expect(await apply(h, manager, batch, requestId)).toEqual(unavailable);
  } finally {
    await h.close();
  }
});

async function verifyHeldRegisterGuards(
  h: TestDb,
  manager: NativeSessionRef,
  assetId: string,
  version: number,
  locationId: string,
) {
  expect(
    await changeAsset(h, manager, {
      type: "move",
      assetId,
      version,
      locationId,
      reason: "Direct move while held",
    }),
  ).toEqual({ ok: false, error: "state" });
  expect(
    await changeAsset(h, manager, {
      type: "setArchive",
      assetId,
      version,
      archived: true,
      reason: "Archive while held",
    }),
  ).toEqual({ ok: false, error: "state" });
}

async function handBackToStorage(
  h: TestDb,
  manager: NativeSessionRef,
  input: {
    siteId: string;
    assetId: string;
    version: number;
    holdingId: string;
    custodianId: string;
    locationId: string;
  },
) {
  const { custodianId, ...target } = input;
  const transferred = custodySucceeded(
    await apply(h, manager, {
      ...handover,
      ...target,
      type: "transfer",
      custodianId,
      quantity: 1,
    }),
  );
  const destination = transferred.value.custody.holdings.find(
    ({ assetId, custodianId: current }) => assetId === target.assetId && current === custodianId,
  );
  assert(destination !== undefined);
  const roster = transferred.value.custody.custodians.find(({ id }) => id === custodianId);
  assert(roster !== undefined);
  custodySucceeded(
    await apply(h, manager, {
      type: "saveCustodian",
      siteId: roster.siteId,
      custodianId: roster.id,
      version: roster.version,
      staffId: null,
      name: "Renamed technician",
      active: false,
    }),
  );
  return custodySucceeded(
    await apply(h, manager, {
      ...target,
      type: "return",
      holdingId: destination.id,
      version: target.version + 1,
      quantity: 1,
      condition: "worn",
      note: "Inspected and placed into storage.",
    }),
  ).value;
}

async function verifyLinkedHistory(h: TestDb, assetId: string, managerId: string) {
  const joined = await h.db
    .select({
      id: assetCustodyHistory.id,
      action: assetCustodyHistory.action,
      version: assetCustodyHistory.version,
      assetVersion: assetEvents.version,
      kind: assetEvents.kind,
      actorId: assetEvents.actorId,
    })
    .from(assetCustodyHistory)
    .innerJoin(assetEvents, eq(assetEvents.id, assetCustodyHistory.id))
    .where(eq(assetCustodyHistory.assetId, assetId))
    .orderBy(asc(assetCustodyHistory.version));
  expect(
    joined.map(({ action, version, assetVersion, kind, actorId }) => ({
      action,
      version,
      assetVersion,
      kind,
      actorId,
    })),
  ).toEqual(
    (["assign", "transfer", "return"] as const).map((action, index) => ({
      action,
      version: index + 2,
      assetVersion: index + 2,
      kind: "updated",
      actorId: managerId,
    })),
  );
}

it("splits returnable custody while crediting partial returns to the selected and original bins", async () => {
  const h = await makeTestDb();
  try {
    const { admin, source, recovery } = await seedStructures(h);
    const { siteId } = source;
    const pool = await createAsset(h, admin, source, "RETURNABLE-CABLE", 12);
    const stocked = await changeAsset(h, admin, {
      type: "changePool",
      assetId: pool.id,
      version: pool.version,
      operation: "restock",
      locationId: recovery.locationId,
      toLocationId: null,
      quantity: 8,
      reason: "Opening equipment pool",
    });
    assert(stocked.ok);
    const first = await addExternal(h, admin, siteId, "Equipment team A");
    const second = await addExternal(h, admin, siteId, "Equipment team B");
    const initial = record(stocked.value, pool.id).version;
    const target = { ...handover, siteId, assetId: pool.id };
    const loan = custodySucceeded(
      await apply(h, admin, {
        ...target,
        type: "assign",
        version: initial,
        locationId: source.locationId,
        custodianId: first.id,
        quantity: 8,
      }),
    );
    const original = loan.value.custody.holdings[0];
    assert(original !== undefined);
    custodySucceeded(
      await apply(h, admin, {
        ...target,
        type: "assign",
        version: initial + 1,
        locationId: recovery.locationId,
        custodianId: second.id,
        quantity: 3,
      }),
    );
    const transfer = custodySucceeded(
      await apply(h, admin, {
        ...target,
        type: "transfer",
        version: initial + 2,
        locationId: recovery.locationId,
        holdingId: original.id,
        custodianId: second.id,
        quantity: 3,
      }),
    );
    const split = transfer.value.custody.holdings.find(
      ({ sourceLocationId, custodianId }) =>
        sourceLocationId === source.locationId && custodianId === second.id,
    );
    assert(split !== undefined);
    expect(split).toMatchObject({ quantity: 3, locationId: recovery.locationId });
    custodySucceeded(
      await apply(h, admin, {
        ...target,
        type: "return",
        version: initial + 3,
        locationId: recovery.locationId,
        holdingId: split.id,
        quantity: 2,
      }),
    );
    const settled = custodySucceeded(
      await apply(h, admin, {
        ...target,
        type: "return",
        version: initial + 4,
        holdingId: split.id,
        quantity: 1,
      }),
    );
    const latest = settled.value.custody.events.filter(({ assetId }) => assetId === pool.id);
    expect(latest).toMatchObject([
      { action: "return", holdingId: split.id, quantity: 1, locationId: source.locationId },
      { action: "return", holdingId: split.id, quantity: 2, locationId: recovery.locationId },
      { action: "transfer", holdingId: original.id, destinationHoldingId: split.id, quantity: 3 },
      { action: "assign", quantity: 3 },
      { action: "assign", quantity: 8 },
    ]);

    const balances = await h.db
      .select()
      .from(assetBalances)
      .where(eq(assetBalances.assetId, pool.id));
    expect(balances).toHaveLength(2);
    expect(balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ locationId: source.locationId, quantity: 5 }),
        expect.objectContaining({ locationId: recovery.locationId, quantity: 7 }),
      ]),
    );
    const holdings = await h.db
      .select()
      .from(assetCustodyHoldings)
      .where(eq(assetCustodyHoldings.assetId, pool.id));
    expect(holdings).toHaveLength(2);
    expect(holdings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: original.id, custodianId: first.id, quantity: 5 }),
        expect.objectContaining({
          custodianId: second.id,
          sourceLocationId: recovery.locationId,
          quantity: 3,
        }),
      ]),
    );
    expect([...holdings, ...balances].reduce((sum, row) => sum + row.quantity, 0)).toBe(20);
  } finally {
    await h.close();
  }
});

it("rolls back a pool assignment when custody history fails and retries the same request", async () => {
  const h = await makeTestDb();
  try {
    const { admin, source } = await seedStructures(h);
    const pool = await createAsset(h, admin, source, "CUSTODY-ROLLBACK-POOL", 12);
    const custodian = await addExternal(h, admin, source.siteId, "Rollback test technician");
    const original = {
      ...handover,
      ...source,
      type: "assign",
      assetId: pool.id,
      version: pool.version,
      custodianId: custodian.id,
      quantity: 3,
    } satisfies CustodyIntent;
    custodySucceeded(await apply(h, admin, original));
    const before = await workspace(h, admin);
    const input = { ...original, version: pool.version + 1, quantity: 2 };
    const requestId = randomUUID();

    await h.db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE FUNCTION test_reject_custody_history() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM asset_custody_holdings WHERE id = NEW.holding_id AND quantity = 2
          ) OR NOT EXISTS (
            SELECT 1 FROM asset_balances WHERE asset_id = NEW.asset_id
              AND location_id = NEW.source_location_id AND quantity = 7
          ) OR NOT EXISTS (
            SELECT 1 FROM asset_events WHERE id = NEW.id AND version = NEW.version
          ) THEN
            RAISE EXCEPTION 'Custody history reached before both quantities and the asset event';
          END IF;
          RAISE EXCEPTION 'Test rejected custody history insert' USING ERRCODE = '23514';
        END;
        $$;
      `);
      await tx.execute(sql`
        CREATE TRIGGER test_reject_custody_history BEFORE INSERT ON asset_custody_history
        FOR EACH ROW EXECUTE FUNCTION test_reject_custody_history()
      `);
    });
    try {
      await expect(apply(h, admin, input, requestId)).rejects.toMatchObject({
        cause: { code: "23514", message: "Test rejected custody history insert" },
      });
    } finally {
      await h.db.transaction(async (tx) => {
        await tx.execute(sql`DROP TRIGGER test_reject_custody_history ON asset_custody_history`);
        await tx.execute(sql`DROP FUNCTION test_reject_custody_history()`);
      });
    }

    expect(await workspace(h, admin)).toEqual(before);
    const receipts = () =>
      h.db.select().from(assetCustodyReceipts).where(eq(assetCustodyReceipts.requestId, requestId));
    expect(await receipts()).toEqual([]);

    const retried = custodySucceeded(await apply(h, admin, input, requestId));
    expect(record(retried.value, pool.id)).toMatchObject({
      version: pool.version + 2,
      balances: [{ locationId: source.locationId, quantity: 7 }],
    });
    expect(
      retried.value.custody.holdings.map(({ quantity }) => quantity).sort((a, b) => a - b),
    ).toEqual([2, 3]);
    expect(retried.value.custody.events).toMatchObject([
      { assetId: pool.id, action: "assign", quantity: 2 },
      { assetId: pool.id, action: "assign", quantity: 3 },
    ]);
    expect(await receipts()).toHaveLength(1);
  } finally {
    await h.close();
  }
});
