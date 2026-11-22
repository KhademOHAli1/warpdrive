import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { createSourcingActor, setRole } from "@/features/inventory/sourcing/sourcing.test-helpers";
import { actor, signal } from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { readBookingWorkspace, runBookingCommand } from "../bookings/service";
import type { AssetIntent } from "../contracts";
import { runAssetCommand } from "../service";
import { runAssetRegisterBatch } from "./batchService";
import type { AssetRegisterBatchInput } from "./contracts";
import { assetRegisterDiscoveryReceipts } from "./schema";

const unavailable = { ok: false, error: "unavailable" } as const;

async function register(h: TestDb, who: NativeSessionRef, input: AssetIntent) {
  const result = await runAssetCommand(h.db, who, { ...input, requestId: randomUUID() }, signal());
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

async function seedRegister(h: TestDb) {
  const { db } = h;
  const admin = await actor(h, "Enterprise admin", true);
  const siteId = randomUUID();
  const east = randomUUID();
  const binId = randomUUID();
  await db.insert(directorySites).values([
    { id: siteId, code: "BENCH", name: "Bench west" },
    { id: east, code: "REMOTE", name: "Remote facility" },
  ]);
  await db.insert(directoryLocations).values({
    id: binId,
    siteId,
    code: "BENCH-1",
    name: "Instrumentation bench",
  });
  const manager = await createSourcingActor(h, admin, "Equipment manager", siteId, "asset_manager");
  const reader = await createSourcingActor(h, admin, "Equipment reader", siteId, "asset_viewer");
  const warehouse = await createSourcingActor(
    h,
    admin,
    "Warehouse operator",
    siteId,
    "warehouse_manager",
  );
  const remote = await createSourcingActor(h, admin, "Remote manager", east, "asset_manager");
  const common = {
    name: "Voltage meter",
    description: null,
    categoryId: null,
    tags: [],
    fieldValues: {},
  };
  await register(h, manager, {
    ...common,
    type: "saveModel",
    siteId,
    code: "FLEET-A",
    modelId: null,
    version: null,
  });
  const models = await register(h, manager, {
    ...common,
    type: "saveModel",
    siteId,
    code: "FLEET-B",
    modelId: null,
    version: null,
  });
  const original = models.models.find(({ code }) => code === "FLEET-A");
  const destination = models.models.find(({ code }) => code === "FLEET-B");
  assert(original !== undefined && destination !== undefined);
  await register(h, manager, {
    type: "createFleet",
    siteId,
    modelId: original.id,
    locationId: binId,
    units: [2, 10, 25].map((value) => ({ code: `METER-${value}`, serial: `SERIAL-${value}` })),
  });
  const registerWithPool = await register(h, manager, {
    ...common,
    name: "Pooled probes",
    code: "PROBES",
    type: "create",
    siteId,
    locationId: binId,
    tracking: "returnable_pool",
    serial: null,
    modelId: null,
    openingQuantity: 10,
  });
  const outsideRegister = await register(h, remote, {
    ...common,
    code: "REMOTE-METER",
    type: "create",
    siteId: east,
    locationId: null,
    tracking: "individual",
    serial: null,
    modelId: null,
    openingQuantity: 0,
  });
  const first = registerWithPool.records.find(({ code }) => code === "METER-2");
  const second = registerWithPool.records.find(({ code }) => code === "METER-10");
  const third = registerWithPool.records.find(({ code }) => code === "METER-25");
  const pool = registerWithPool.records.find(({ code }) => code === "PROBES");
  const outside = outsideRegister.records.find(({ code }) => code === "REMOTE-METER");
  assert(first && second && third && pool && outside);
  return {
    admin,
    manager,
    reader,
    warehouse,
    remote,
    siteId,
    original,
    destination,
    first,
    second,
    third,
    pool,
    outside,
  };
}

it("persists exact applied outcomes, protects scheduled model capacity, and reauthorizes replay", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedRegister(h);
    const { db } = h;
    const { manager, original, destination, siteId, first, second, third, pool, outside } = f;
    const future = Date.now() + 96 * 3_600_000;
    const maintenance = await runBookingCommand(
      db,
      manager,
      {
        type: "saveMaintenance",
        requestId: randomUUID(),
        siteId,
        maintenanceId: null,
        version: null,
        title: "Calibration of two fleet meters",
        window: {
          startAt: new Date(future).toISOString(),
          endAt: new Date(future + 3_600_000).toISOString(),
        },
        demand: { kind: "model", resourceId: original.id, locationId: null, quantity: 2 },
      },
      signal(),
    );
    assert(maintenance.ok, JSON.stringify(maintenance));
    await register(h, manager, {
      type: "note",
      assetId: third.id,
      version: third.version,
      reason: "Verified serial before the batch",
    });
    const input = {
      siteId,
      requestId: randomUUID(),
      intent: { type: "setModel", modelId: destination.id },
      selection: [first, second, pool, third, outside].map(({ id, version }) => ({
        assetId: id,
        version,
      })),
    } satisfies AssetRegisterBatchInput;
    for (const denied of [f.reader, f.warehouse, f.remote]) {
      expect(await runAssetRegisterBatch(db, denied, input, signal())).toEqual(unavailable);
    }
    const result = await runAssetRegisterBatch(db, manager, input, signal());
    assert(result.ok, JSON.stringify(result));
    expect(result.outcomes.map(({ state, reason }) => [state, reason])).toEqual([
      ["applied", "changed"],
      ["conflict", "protected"],
      ["skipped", "incompatible"],
      ["conflict", "stale"],
      ["unavailable", "unavailable"],
    ]);
    expect(result.outcomes.map(({ assetId }) => assetId)).toEqual(
      input.selection.map(({ assetId }) => assetId),
    );
    const row = result.workspace.records.find(({ id }) => id === first.id);
    assert(row !== undefined);
    expect(row).toMatchObject({
      serial: "SERIAL-2",
      modelId: destination.id,
      version: first.version + 1,
      events: [
        expect.objectContaining({ reason: "FLEET-A → FLEET-B", actor: "Equipment manager" }),
        ...first.events,
      ],
    });
    expect(result.workspace.records.find(({ id }) => id === second.id)).toEqual(second);
    expect(result.workspace.records.find(({ id }) => id === pool.id)).toEqual(pool);
    expect(result.workspace.records.find(({ id }) => id === outside.id)).toBeUndefined();
    const currentMaintenance = await readBookingWorkspace(db, manager, signal());
    assert(currentMaintenance.ok);
    expect(currentMaintenance.value.maintenance).toEqual(maintenance.value.maintenance);
    const receipts = await db
      .select()
      .from(assetRegisterDiscoveryReceipts)
      .where(eq(assetRegisterDiscoveryReceipts.requestId, input.requestId));
    expect(receipts).toMatchObject([
      { actorId: manager.userId, siteId, kind: "batch", outcomes: result.outcomes },
    ]);
    expect(await runAssetRegisterBatch(db, manager, input, signal())).toEqual(result);
    expect(
      await runAssetRegisterBatch(
        db,
        manager,
        { ...input, intent: { type: "removeTags", tags: ["Calibration"] } },
        signal(),
      ),
    ).toEqual({ ok: false, error: "conflict" });
    await setRole(h, f.admin, manager, siteId, "asset_manager", false);
    expect(await runAssetRegisterBatch(db, manager, input, signal())).toEqual(unavailable);
  } finally {
    await h.close();
  }
});
