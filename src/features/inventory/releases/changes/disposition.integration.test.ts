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
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { FakeStorageClient } from "@/features/files/storageFake";
import { directorySiteGrants } from "@/features/locations/schema";
import type { TestDb } from "@/test/db";
import {
  inventoryProductionBuilds,
  inventoryProductionOutputs,
} from "../../production/buildSchema";
import { runProductionCommand } from "../../production/service";
import { writeProductionStock } from "../../production/stock";
import { inventoryItems, inventoryMovements, inventoryOrders } from "../../schema";
import { lockInventoryStock } from "../../stock";
import {
  readWarehouseMovementHistory,
  readWarehouseTransfers,
} from "../../warehouse/operations/reads";
import {
  actor,
  command,
  counts,
  incumbentRows,
  position,
  seedStructures,
  signal,
  value,
} from "../../warehouse/operations/structures.test-helpers";
import {
  inventoryStockAllocations,
  inventoryStockEventDetails,
  inventoryStockEvents,
  inventoryStockPositions,
} from "../../warehouse/schema";
import { runWarehouseCommand } from "../../warehouse/service";
import { confirmReleaseArtifactUpload, requestReleaseArtifactUpload } from "../artifacts";
import { createReleaseFixture } from "../fixtures";
import { inventoryProductReleases } from "../schema";
import { executeReleaseMetadata } from "../service";
import type { EngineeringChangeCommand, EngineeringChangeWorkspace } from "./contracts";
import {
  inventoryEngineeringChanges,
  inventoryEngineeringHolds,
  inventoryEngineeringRequests,
} from "./schema";
import {
  executeEngineeringChange,
  readEngineeringChangeReview,
  readEngineeringWorkspace,
} from "./service";

type Fixture = Awaited<ReturnType<typeof seedStructures>>;
type StockCommand = Extract<EngineeringChangeCommand, { type: "disposition" }>;

async function packageFiles(
  h: TestDb,
  f: Fixture,
  storage: FakeStorageClient,
  revision: "A" | "B",
) {
  const itemId = f.parent.itemId;
  const { releaseId } = value(
    await executeReleaseMetadata(
      h.db,
      f.admin,
      { type: "createDraft", itemId, revision },
      signal(),
    ),
  );
  assert(releaseId !== undefined);
  const [item] = await h.db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId));
  assert(item !== undefined);
  const archive = createReleaseFixture({
    ...item,
    sku: "IO-24-DIN",
    bom: [],
    available: 0,
    template: null,
  }).releases[0]?.artifacts.find(({ kind }) => kind === "pcbFabrication");
  assert(archive !== undefined);
  const files = [
    {
      kind: "pcbFabrication",
      name: `${revision}-gerbers.zip`,
      bytes: Buffer.from(await archive.bytes.arrayBuffer()),
      contentType: "application/zip",
    },
    {
      kind: "manufacturingBom",
      name: `${revision}-bom.csv`,
      bytes: Buffer.from(`sku,quantity\nCONTROL-0132,${revision === "A" ? 1 : 2}\n`),
      contentType: "text/csv",
    },
  ] as const;
  for (const { kind, name, bytes, contentType } of files) {
    const { post, artifactId } = value(
      await requestReleaseArtifactUpload(
        h.db,
        f.admin,
        {
          releaseId,
          kind,
          name,
          sizeBytes: bytes.length,
        },
        signal(),
        storage,
      ),
    );
    const key = post.fields.key;
    assert(key !== undefined);
    expect(await storage.putObjectBytes(key, bytes, contentType, signal())).toMatchObject({
      ok: true,
    });
    value(
      await confirmReleaseArtifactUpload(
        h.db,
        f.admin,
        { releaseId, artifactId },
        signal(),
        storage,
      ),
    );
  }
  return releaseId;
}

async function existingOutput(
  h: TestDb,
  f: Fixture,
  bin: Fixture["source"],
  releaseId: string,
  lot: string,
  quantity: number,
  serial?: string,
) {
  return h.db.transaction(async (tx) => {
    const itemId = f.parent.itemId;
    const createdBy = f.admin.userId;
    const { siteId, locationId } = bin;
    const trackable = serial !== undefined;
    const locked = await lockInventoryStock(tx, [itemId]);
    const [build] = await tx
      .insert(inventoryProductionBuilds)
      .values({
        ...bin,
        itemId,
        releaseId,
        quantity,
        trackable,
        createdBy,
        stockUnit: "each",
        priority: "normal",
      })
      .returning();
    assert(build !== undefined);
    await tx
      .update(inventoryProductionBuilds)
      .set({ status: "issued", version: build.version + 1 })
      .where(eq(inventoryProductionBuilds.id, build.id));
    const [output] = await tx
      .insert(inventoryProductionOutputs)
      .values({ buildId: build.id, itemId, releaseId, quantity, createdBy })
      .returning();
    assert(output !== undefined);
    const [record] = await tx
      .insert(inventoryStockPositions)
      .values({
        siteId,
        locationId,
        itemId,
        buildOutputId: output.id,
        lot,
        serial,
        onHand: 0,
      })
      .returning();
    assert(record !== undefined);
    await writeProductionStock(tx, createdBy, randomUUID(), locked, "production-output", {
      position: record,
      onHandDelta: quantity,
      reservedDelta: 0,
    });
    await tx
      .update(inventoryProductionOutputs)
      .set({
        status: "completed",
        lot,
        serials: serial === undefined ? [] : [serial],
        reason: "Historical production release A",
        settledBy: createdBy,
        settledAt: sql`clock_timestamp()`,
      })
      .where(eq(inventoryProductionOutputs.id, output.id));
    await tx
      .update(inventoryProductionBuilds)
      .set({
        status: "closed",
        completed: quantity,
        version: build.version + 2,
      })
      .where(eq(inventoryProductionBuilds.id, build.id));
    return record;
  });
}

async function incumbentReservation(h: TestDb, f: Fixture, reservedPositionId: string) {
  const itemId = f.parent.itemId;
  const actorId = f.admin.userId;
  const requestId = randomUUID();
  const [order] = await h.db
    .insert(inventoryOrders)
    .values({
      itemId,
      quantity: 1,
      reserved: 1,
      buildQuantity: 0,
      status: "ready",
      createdBy: actorId,
    })
    .returning();
  assert(order !== undefined);
  await h.db.update(inventoryItems).set({ reserved: 1 }).where(eq(inventoryItems.id, itemId));
  await h.db
    .update(inventoryStockPositions)
    .set({ reserved: 1 })
    .where(eq(inventoryStockPositions.id, reservedPositionId));
  await h.db.insert(inventoryStockAllocations).values({
    orderId: order.id,
    itemId,
    positionId: reservedPositionId,
    quantity: 1,
  });
  const [movement] = await h.db
    .insert(inventoryMovements)
    .values({
      itemId,
      orderId: order.id,
      actorId,
      requestId,
      kind: "order-reserve",
      reservedDelta: 1,
      onHandDelta: 0,
    })
    .returning();
  assert(movement !== undefined);
  await h.db.insert(inventoryStockEvents).values({
    itemId,
    actorId,
    orderId: order.id,
    requestId,
    kind: "order-reserve",
    movementId: movement.id,
    positionId: reservedPositionId,
    reservedDelta: 1,
  });
}

function stockRow(workspace: EngineeringChangeWorkspace, id: string) {
  const row = workspace.stock?.positions.find((entry) => entry.id === id);
  assert(row !== undefined);
  return row;
}

async function grant(
  h: TestDb,
  f: Fixture,
  who: NativeSessionRef,
  role: "editor" | "approver" | null,
) {
  value(
    await executeReleaseMetadata(
      h.db,
      f.admin,
      { type: "setGrant", itemId: f.parent.itemId, userId: who.userId, role },
      signal(),
    ),
  );
}

function releaseSource(h: TestDb) {
  return h.db.select().from(inventoryProductionBuilds).orderBy(asc(inventoryProductionBuilds.id));
}

async function moveCheckedSerial(h: TestDb, f: Fixture, positionId: string) {
  const { id } = value(
    await command(h, f.admin, {
      type: "createTransfer",
      sourceLocationId: f.source.locationId,
      destinationLocationId: f.remote.locationId,
      reason: "Move a cleared serial",
      lines: [{ positionId, quantity: 1 }],
    }),
  );
  const readTransfer = async () => {
    const row = value(await readWarehouseTransfers(h.db, f.admin, {}, signal())).rows.find(
      (row) => row.id === id,
    );
    assert(row !== undefined);
    return row;
  };
  value(
    await command(h, f.admin, {
      type: "dispatchTransfer",
      id,
      version: (await readTransfer()).version,
      reason: "Send cleared serial",
    }),
  );
  const dispatched = await readTransfer();
  const lineId = dispatched.lines[0]?.id;
  assert(lineId !== undefined);
  value(
    await command(h, f.admin, {
      type: "receiveTransfer",
      id,
      version: dispatched.version,
      reason: "Receive cleared serial",
      lines: [{ lineId, quantity: 1 }],
    }),
  );
}

it("upgrades a populated release and holds only the exact previous revision output through the Warehouse ledger", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 157);
    const f = await seedStructures(h);
    const itemId = f.parent.itemId;
    const storage = new FakeStorageClient();
    const baseReleaseId = await packageFiles(h, f, storage, "A");
    value(
      await executeReleaseMetadata(
        h.db,
        f.admin,
        { type: "approve", releaseId: baseReleaseId },
        signal(),
        storage,
      ),
    );
    const candidateReleaseId = await packageFiles(h, f, storage, "B");
    const serial = await existingOutput(h, f, f.source, baseReleaseId, "FIRST-LOT", 1, "CHG-A-001");
    const generalHold = await existingOutput(h, f, f.source, baseReleaseId, "WAREHOUSE-HOLD", 3);
    const reserved = await existingOutput(h, f, f.source, baseReleaseId, "ALLOCATED", 4);
    const inTransfer = await existingOutput(h, f, f.source, baseReleaseId, "DRAFT-TRANSFER", 2);
    const remote = await existingOutput(h, f, f.remote, baseReleaseId, "OTHER-SITE", 2);
    await incumbentReservation(h, f, reserved.id);
    value(
      await runWarehouseCommand(
        h.db,
        f.admin,
        {
          type: "setPositionState",
          id: generalHold.id,
          state: "hold",
          quantity: 3,
          requestId: randomUUID(),
        },
        signal(),
      ),
    );
    value(
      await command(h, f.admin, {
        type: "createTransfer",
        sourceLocationId: f.source.locationId,
        destinationLocationId: f.remote.locationId,
        reason: "Incumbent transfer custody",
        lines: [{ positionId: inTransfer.id, quantity: 1 }],
      }),
    );
    const before = await incumbentRows(h);
    const pins = await releaseSource(h);
    const occupied = await ledger(h);
    expect(occupied).toHaveLength(157);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    expect((await ledger(h)).slice(0, 157)).toEqual(occupied);
    expect(await incumbentRows(h)).toEqual(before);
    expect(await releaseSource(h)).toEqual(pins);

    const editor = await actor(h, "Product editor and warehouse manager");
    const approver = await actor(h, "Independent engineering approver");
    const viewer = await actor(h, "Engineering observer");
    const remoteManager = await actor(h, "Manager in the other warehouse");
    await grant(h, f, editor, "editor");
    await grant(h, f, approver, "approver");
    await grant(h, f, viewer, "editor");
    await grant(h, f, remoteManager, "editor");
    await h.db.insert(directorySiteGrants).values([
      { siteId: f.source.siteId, userId: editor.userId, role: "manager" },
      { siteId: f.source.siteId, userId: viewer.userId, role: "viewer" },
      { siteId: f.remote.siteId, userId: remoteManager.userId, role: "manager" },
    ]);

    const read = async (who: NativeSessionRef) =>
      value(await readEngineeringWorkspace(h.db, who, itemId, signal()));
    const send = (who: NativeSessionRef, input: EngineerInput) =>
      executeEngineeringChange(
        h.db,
        who,
        { itemId, requestId: randomUUID(), ...input },
        signal(),
        storage,
      );
    const review = value(
      await readEngineeringChangeReview(h.db, editor, itemId, candidateReleaseId, signal()),
    );
    expect(review).toMatchObject({
      ready: true,
      base: { id: baseReleaseId },
      candidate: { id: candidateReleaseId },
    });
    const effectiveAt = new Date(Date.now() + 5_000).toISOString();
    const submitted = value(
      await send(editor, {
        type: "submit",
        candidateReleaseId,
        baseReleaseId,
        fingerprint: review.fingerprint,
        effectiveAt,
        reason: "Replace the controller while retaining existing output provenance",
      }),
    );
    const change = submitted.changes[0];
    assert(change !== undefined);
    const changeId = change.id;
    value(
      await send(approver, {
        type: "approve",
        changeId,
        expectedVersion: change.version,
        fingerprint: review.fingerprint,
      }),
    );
    const createProduction = (releaseId: string, requestId = randomUUID()) => ({
      type: "createBuild",
      requestId,
      releaseId,
      ...f.source,
      quantity: 1,
      priority: "normal",
      dueDate: null,
      useTemplate: false,
      choices: [],
    });
    const placeProduction = (input: ReturnType<typeof createProduction>) =>
      runProductionCommand(h.db, editor, input, signal());
    const originalA = createProduction(baseReleaseId);
    const priorA = value(await placeProduction(originalA)).buildId;
    expect(await placeProduction(createProduction(candidateReleaseId))).toEqual({
      ok: false,
      error: "stale",
    });
    // Advance to the real persisted boundary without changing the approval or system clock.
    await h.db.execute(sql`SELECT pg_sleep(greatest(0, extract(epoch FROM (effective_at - clock_timestamp()))) + 0.025)
      FROM ${inventoryEngineeringChanges} WHERE id = ${changeId}`);
    expect(await placeProduction(createProduction(baseReleaseId))).toEqual({
      ok: false,
      error: "stale",
    });
    const afterB = value(await placeProduction(createProduction(candidateReleaseId))).buildId;
    expect(afterB).not.toBe(priorA);
    expect(value(await placeProduction(originalA)).buildId).toBe(priorA);
    const cutoverBuilds = await releaseSource(h);
    expect(cutoverBuilds.find(({ id }) => id === priorA)?.releaseId).toBe(baseReleaseId);
    expect(cutoverBuilds.find(({ id }) => id === afterB)?.releaseId).toBe(candidateReleaseId);

    const available = await read(editor);
    const first = stockRow(available, serial.id);
    expect(first).toMatchObject({
      changeId,
      revision: "A",
      status: "available",
      quantity: "1",
      reserved: "0",
      serial: "CHG-A-001",
      canDispose: true,
    });
    expect(available.stock).toMatchObject({ unattributed: true });
    expect(
      available.stock?.positions.some(({ id }) => id === f.parent.positionId || id === remote.id),
    ).toBe(false);
    expect(stockRow(available, generalHold.id)).toMatchObject({
      status: "unavailable",
      canDispose: false,
    });
    expect(stockRow(available, reserved.id)).toMatchObject({ reserved: "1", canDispose: false });
    expect(stockRow(available, inTransfer.id)).toMatchObject({ canDispose: false });
    expect(stockRow(await read(viewer), serial.id)).toMatchObject({ canDispose: false });
    expect((await read(approver)).stock).toBe(null);

    function hold(row: { id: string; version: string }, requestId = randomUUID()): StockCommand {
      return {
        itemId,
        changeId,
        positionId: row.id,
        expectedPositionVersion: row.version,
        requestId,
        type: "disposition",
        action: "hold",
        reason: "Segregate previous-release stock",
      };
    }
    const apply = (who: NativeSessionRef, input: StockCommand) =>
      executeEngineeringChange(h.db, who, input, signal(), storage);
    expect(await apply(viewer, hold(first))).toEqual({ ok: false, error: "unavailable" });
    expect(await apply(remoteManager, hold(first))).toEqual({
      ok: false,
      error: "stockUnavailable",
    });
    expect(await apply(editor, hold({ id: f.parent.positionId, version: first.version }))).toEqual({
      ok: false,
      error: "stockUnavailable",
    });
    expect(
      await apply(editor, { ...hold(stockRow(available, generalHold.id)), action: "release" }),
    ).toEqual({ ok: false, error: "stockUnavailable" });
    expect(await apply(editor, hold(stockRow(available, reserved.id)))).toEqual({
      ok: false,
      error: "stockUnavailable",
    });
    expect(await apply(editor, hold(stockRow(available, inTransfer.id)))).toEqual({
      ok: false,
      error: "stockUnavailable",
    });

    const stockBefore = await counts(h, itemId);
    const original = hold(first);
    const [held, replay] = (
      await Promise.all([apply(editor, original), apply(editor, original)])
    ).map(value);
    assert(held !== undefined && replay !== undefined);
    const current = stockRow(held, serial.id);
    expect(current).toMatchObject({
      status: "held",
      canDispose: true,
      history: [{ action: "hold", reason: original.reason }],
    });
    expect(stockRow(replay, serial.id).history).toEqual(current.history);
    expect(current.version).not.toBe(first.version);
    expect(
      await apply(editor, { ...original, requestId: randomUUID(), action: "release" }),
    ).toEqual({ ok: false, error: "conflict" });
    expect(
      await runWarehouseCommand(
        h.db,
        f.admin,
        {
          type: "setPositionState",
          id: serial.id,
          state: "available",
          quantity: 1,
          requestId: randomUUID(),
        },
        signal(),
      ),
    ).toEqual({ ok: false, error: "conflict" });
    expect(
      await command(h, f.admin, {
        type: "correctStock",
        positionId: serial.id,
        locationId: f.source.locationId,
        expectedOnHand: 1,
        countedQuantity: 0,
        reason: "Cannot adjust engineering custody",
      }),
    ).toEqual({ ok: false, error: "incompatibleStock" });

    const release = {
      ...hold(current),
      action: "release",
      reason: "Engineering review cleared this exact serial",
    } as const;
    const settled = stockRow(value(await apply(editor, release)), serial.id);
    expect(settled).toMatchObject({
      status: "available",
      history: [{ action: "hold" }, { action: "release", reason: release.reason }],
    });
    expect(await counts(h, itemId)).toEqual(stockBefore);
    expect(await position(h, generalHold.id)).toMatchObject({ state: "hold", onHand: 3 });
    expect(await position(h, reserved.id)).toMatchObject({
      state: "available",
      onHand: 4,
      reserved: 1,
    });
    const [owner] = await h.db
      .select()
      .from(inventoryEngineeringHolds)
      .where(eq(inventoryEngineeringHolds.positionId, serial.id));
    expect(owner).toMatchObject({
      changeId,
      baseReleaseId,
      buildOutputId: serial.buildOutputId,
      holdEventId: settled.history[0]?.id,
      releaseEventId: settled.history[1]?.id,
    });
    const requests = [original.requestId, release.requestId];
    expect(
      await h.db
        .select()
        .from(inventoryEngineeringRequests)
        .where(inArray(inventoryEngineeringRequests.requestId, requests)),
    ).toHaveLength(2);
    expect(
      await h.db
        .select()
        .from(inventoryMovements)
        .where(inArray(inventoryMovements.requestId, requests)),
    ).toEqual([]);
    expect(
      await h.db
        .select({
          kind: inventoryStockEvents.kind,
          state: inventoryStockEvents.state,
          previous: inventoryStockEvents.previousState,
          quantity: inventoryStockEventDetails.previousOnHand,
          delta: inventoryStockEvents.onHandDelta,
          reserved: inventoryStockEvents.reservedDelta,
          reason: inventoryStockEventDetails.reason,
        })
        .from(inventoryStockEvents)
        .innerJoin(
          inventoryStockEventDetails,
          eq(inventoryStockEventDetails.eventId, inventoryStockEvents.id),
        )
        .where(inArray(inventoryStockEvents.requestId, requests))
        .orderBy(asc(inventoryStockEventDetails.sequence)),
    ).toEqual([
      {
        kind: "engineering-disposition",
        state: "hold",
        previous: "available",
        quantity: 1,
        delta: 0,
        reserved: 0,
        reason: original.reason,
      },
      {
        kind: "engineering-disposition",
        state: "available",
        previous: "hold",
        quantity: 1,
        delta: 0,
        reserved: 0,
        reason: release.reason,
      },
    ]);

    const history = value(
      await readWarehouseMovementHistory(
        h.db,
        editor,
        { itemId, siteId: f.source.siteId, kind: "engineering-disposition" },
        signal(),
      ),
    );
    expect(history.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: settled.history[0]?.id,
          affectedQuantity: 1,
          onHandDelta: 0,
          reason: original.reason,
        }),
        expect.objectContaining({
          id: settled.history[1]?.id,
          affectedQuantity: 1,
          onHandDelta: 0,
          reason: release.reason,
        }),
      ]),
    );

    await h.db
      .delete(directorySiteGrants)
      .where(
        and(
          eq(directorySiteGrants.siteId, f.source.siteId),
          eq(directorySiteGrants.userId, editor.userId),
        ),
      );
    expect(await apply(editor, release)).toEqual({ ok: false, error: "unavailable" });
    expect((await read(editor)).stock).toBe(null);
    await moveCheckedSerial(h, f, serial.id);
    expect(stockRow(await read(remoteManager), serial.id)).toMatchObject({
      site: "REMOTE",
      status: "available",
      history: [],
    });
    expect(stockRow(await read(f.admin), serial.id).history).toEqual(settled.history);
    expect(await releaseSource(h)).toEqual(cutoverBuilds);
    expect(
      (
        await h.db
          .select()
          .from(inventoryProductReleases)
          .where(eq(inventoryProductReleases.id, baseReleaseId))
      )[0],
    ).toMatchObject({
      status: "released",
      revision: "A",
      bom: [{ sku: "CONTROL-0132", quantity: 1 }],
    });
  } finally {
    await h.close();
  }
});

type EngineerInput = EngineeringChangeCommand extends infer Command
  ? Command extends EngineeringChangeCommand
    ? Omit<Command, "itemId" | "requestId">
    : never
  : never;
