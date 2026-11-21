import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { expect, it } from "vitest";
import { executeLocationsCommand } from "@/features/locations/service";
import { makeTestDb, type TestDb } from "@/test/db";
import { readBomPlanningWorkspace } from "../../bom/service";
import {
  inventoryProductionBuilds,
  inventoryProductionOutputs,
  type ProductionBuildRow,
} from "../../production/buildSchema";
import { writeProductionStock } from "../../production/stock";
import {
  type ApprovedBomLine,
  inventoryProductReleases,
  inventoryReleaseArtifacts,
} from "../../releases/schema";
import { inventoryMovements } from "../../schema";
import { lockInventoryStock } from "../../stock";
import { readEligibleBuildOrigins } from "../productionOrigin";
import {
  inventoryStockEvents,
  inventoryStockInstallations,
  inventoryStockPositions,
} from "../schema";
import { runWarehouseCommand } from "../service";
import { readWarehouseMovementHistory, readWarehouseTransfers } from "./reads";
import {
  command,
  counts,
  position,
  seedStructures,
  signal,
  value,
} from "./structures.test-helpers";

type Fixture = Awaited<ReturnType<typeof seedStructures>>;

async function prepareBuild(
  h: TestDb,
  f: Fixture,
  itemId: string,
  bin: Fixture["source"],
  quantity: number,
  trackable = false,
  bom?: ApprovedBomLine,
) {
  const releaseId = randomUUID();
  const createdBy = f.admin.userId;
  const component = bom ?? {
    itemId: f.child.itemId,
    sku: "CONTROL-0132",
    name: "CONTROL-0132",
    quantity: 1,
  };
  await h.db
    .insert(inventoryProductReleases)
    .values({ id: releaseId, itemId, revision: "PROD", createdBy });
  const file = {
    releaseId,
    createdBy,
    sizeBytes: 32,
    state: "ready",
    sha256: "e".repeat(64),
    etag: "fixture",
  } as const;
  await h.db.insert(inventoryReleaseArtifacts).values([
    {
      ...file,
      kind: "pcbFabrication",
      contentType: "application/zip",
      name: "gerbers.zip",
      objectKey: `${releaseId}/gerbers`,
    },
    {
      ...file,
      kind: "manufacturingBom",
      contentType: "text/csv",
      name: "bom.csv",
      objectKey: `${releaseId}/bom`,
      bomEntries: [{ sku: component.sku, quantity: component.quantity }],
    },
  ]);
  await h.db
    .update(inventoryProductReleases)
    .set({ status: "released", approvedAt: new Date(), approvedBy: createdBy, bom: [component] })
    .where(eq(inventoryProductReleases.id, releaseId));
  const [build] = await h.db
    .insert(inventoryProductionBuilds)
    .values({
      ...bin,
      itemId,
      quantity,
      releaseId,
      stockUnit: "each",
      trackable,
      priority: "normal",
      createdBy,
    })
    .returning();
  if (build === undefined) throw new Error("Fixture build was not stored");
  return build;
}

async function postFixtureStock(
  h: TestDb,
  build: ProductionBuildRow,
  identity: { lot: string; serial?: string; expiryDate?: string },
) {
  await h.db
    .update(inventoryProductionBuilds)
    .set({ status: "issued", version: build.version + 1 })
    .where(eq(inventoryProductionBuilds.id, build.id));
  return h.db.transaction(async (tx) => {
    const { itemId, releaseId, quantity, createdBy, siteId, locationId } = build;
    const buildOutputId = randomUUID();
    await tx
      .insert(inventoryProductionOutputs)
      .values({ id: buildOutputId, buildId: build.id, itemId, releaseId, quantity, createdBy });
    const stock = await lockInventoryStock(tx, [itemId]);
    const [stored] = await tx
      .insert(inventoryStockPositions)
      .values({ ...identity, siteId, locationId, itemId, buildOutputId, onHand: 0 })
      .returning();
    if (stored === undefined) throw new Error("Fixture output has no position");
    const eventId = await writeProductionStock(
      tx,
      createdBy,
      randomUUID(),
      stock,
      "production-output",
      { position: stored, onHandDelta: quantity, reservedDelta: 0 },
    );
    await tx
      .update(inventoryProductionOutputs)
      .set({
        status: "completed",
        lot: identity.lot,
        serials: identity.serial == null ? [] : [identity.serial],
        reason: "Qualify produced position",
        settledBy: createdBy,
        settledAt: new Date(),
      })
      .where(eq(inventoryProductionOutputs.id, buildOutputId));
    await tx
      .update(inventoryProductionBuilds)
      .set({ status: "closed", version: build.version + 2, completed: quantity })
      .where(eq(inventoryProductionBuilds.id, build.id));
    return { position: stored, eventId, buildOutputId };
  });
}

it("protects the output bin before production puts any stock into it", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    await prepareBuild(h, f, f.parent.itemId, f.recovery, 1);
    expect(
      await executeLocationsCommand(
        h.db,
        f.admin,
        {
          type: "setLocationArchived",
          id: f.recovery.locationId,
          archived: true,
          requestId: randomUUID(),
        },
        signal(),
      ),
    ).toMatchObject({ ok: false, error: "warehouseStock" });
    for (const kind of ["structure", "external"]) {
      expect(
        await runWarehouseCommand(
          h.db,
          f.admin,
          {
            type: "saveLocationPolicy",
            locationId: f.recovery.locationId,
            kind,
            requestId: randomUUID(),
          },
          signal(),
        ),
      ).toMatchObject({ ok: false, error: "conflict" });
    }
  } finally {
    await h.close();
  }
});

it("preserves production lineage through corrections, states, structure changes and cross-site receipts", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    const bulkBuild = await prepareBuild(h, f, f.lot.itemId, f.source, 4);
    const bulk = await postFixtureStock(h, bulkBuild, {
      lot: "MODULE-LOT-01",
      expiryDate: "2099-12-31",
    });
    const serialBuild = await prepareBuild(h, f, f.parent.itemId, f.source, 1, true, {
      itemId: f.lot.itemId,
      sku: "MODULE-0132",
      name: "MODULE-0132",
      quantity: 1,
      spec: {
        enteredQuantity: "1",
        enteredUnit: "each",
        stockUnit: "each",
        childReleaseId: bulkBuild.releaseId,
        alternatives: [],
        optional: false,
        consumable: false,
        inherited: false,
        pieces: null,
      },
    });
    const serial = await postFixtureStock(h, serialBuild, {
      lot: "PROD-SERIAL",
      serial: "NEW-PROD-001",
    });
    const planAt = async (siteId: string, quantity: number) =>
      value(
        await readBomPlanningWorkspace(
          h.db,
          f.admin,
          {
            releaseId: serialBuild.releaseId,
            siteId,
            quantity,
          },
          signal(),
        ),
      ).plan;
    expect((await planAt(f.source.siteId, 5))?.requirements).toMatchObject([
      {
        releaseId: bulkBuild.releaseId,
        required: 5,
        available: 4,
        shortage: 1,
        genericAssemblyAvailable: 6,
      },
      { releaseId: null, part: { id: f.child.itemId }, required: 1 },
    ]);
    const origin = bulk.buildOutputId;
    const fresh = bulk.position;
    const operate = (change: Record<string, unknown>) =>
      command(h, f.admin, { reason: "Production stock QA", ...change });
    expect(
      await operate({
        type: "mergeStock",
        sourcePositionId: fresh.id,
        destinationPositionId: f.lot.positionId,
        locationId: f.source.locationId,
        quantity: 1,
      }),
    ).toEqual({ ok: false, error: "incompatibleStock" });
    const correct = {
      type: "correctStock",
      positionId: fresh.id,
      locationId: f.source.locationId,
      expectedOnHand: 4,
    };
    expect(await operate({ ...correct, countedQuantity: 5 })).toEqual({
      ok: false,
      error: "incompatibleStock",
    });
    const correction = value(await operate({ ...correct, countedQuantity: 3 }));
    value(await operate({ type: "reverseCorrection", eventId: correction.id, expectedOnHand: 3 }));
    expect(await position(h, fresh.id)).toMatchObject({ buildOutputId: origin, onHand: 4 });

    value(
      await operate({
        type: "splitStock",
        sourcePositionId: fresh.id,
        locationId: fresh.locationId,
        quantity: 1,
      }),
    );
    const [split] = await h.db
      .select()
      .from(inventoryStockPositions)
      .where(
        and(
          eq(inventoryStockPositions.buildOutputId, origin),
          ne(inventoryStockPositions.id, fresh.id),
        ),
      );
    if (split === undefined) throw new Error("Attributed split position missing");
    expect(split.onHand).toBe(1);
    value(
      await operate({
        type: "mergeStock",
        sourcePositionId: split.id,
        destinationPositionId: fresh.id,
        locationId: fresh.locationId,
        quantity: 1,
      }),
    );
    const held = await runWarehouseCommand(
      h.db,
      f.admin,
      {
        type: "setPositionState",
        id: fresh.id,
        state: "hold",
        quantity: 1,
        requestId: randomUUID(),
      },
      signal(),
    );
    if (!held.ok || held.focusId === undefined) throw new Error("Attributed hold position missing");
    expect(await position(h, held.focusId)).toMatchObject({
      buildOutputId: origin,
      state: "hold",
      onHand: 1,
    });

    const { id } = value(
      await operate({
        type: "createTransfer",
        sourceLocationId: f.source.locationId,
        destinationLocationId: f.remote.locationId,
        lines: [
          { positionId: fresh.id, quantity: 2 },
          { positionId: serial.position.id, quantity: 1 },
        ],
      }),
    );
    const readTransfer = async () => {
      const row = value(await readWarehouseTransfers(h.db, f.admin, {}, signal())).rows.find(
        (transfer) => transfer.id === id,
      );
      if (row === undefined) throw new Error("Production transfer missing");
      return row;
    };
    value(await operate({ type: "dispatchTransfer", id, version: (await readTransfer()).version }));
    const dispatched = await readTransfer();
    value(
      await operate({
        type: "receiveTransfer",
        id,
        version: dispatched.version,
        lines: dispatched.lines.map(({ id: lineId, quantity }) => ({ lineId, quantity })),
      }),
    );
    expect(await position(h, serial.position.id)).toMatchObject({
      buildOutputId: serial.buildOutputId,
      locationId: f.remote.locationId,
      serial: "NEW-PROD-001",
      onHand: 1,
    });
    const [receivedLot] = await h.db
      .select()
      .from(inventoryStockPositions)
      .where(
        and(
          eq(inventoryStockPositions.buildOutputId, origin),
          eq(inventoryStockPositions.locationId, f.remote.locationId),
        ),
      );
    if (receivedLot === undefined) throw new Error("Transferred produced lot missing");
    expect(receivedLot).toMatchObject({ onHand: 2, state: "available" });
    expect((await planAt(f.remote.siteId, 1))?.requirements).toMatchObject([
      {
        releaseId: bulkBuild.releaseId,
        required: 1,
        available: 2,
        shortage: 0,
        genericAssemblyAvailable: 0,
      },
    ]);

    value(
      await operate({
        type: "installComponent",
        assemblyPositionId: f.parent.positionId,
        componentPositionId: fresh.id,
        locationId: f.source.locationId,
        quantity: 1,
      }),
    );
    const [installation] = await h.db
      .select()
      .from(inventoryStockInstallations)
      .where(eq(inventoryStockInstallations.componentPositionId, fresh.id));
    if (installation === undefined) throw new Error("Attributed component was not installed");
    value(
      await operate({
        type: "removeComponent",
        installationId: installation.id,
        assemblyLocationId: f.source.locationId,
        destinationLocationId: f.recovery.locationId,
      }),
    );
    expect(
      await h.db
        .select()
        .from(inventoryStockPositions)
        .where(
          and(
            eq(inventoryStockPositions.buildOutputId, origin),
            eq(inventoryStockPositions.locationId, f.recovery.locationId),
          ),
        ),
    ).toMatchObject([{ onHand: 1 }]);
    expect(await counts(h, f.lot.itemId)).toEqual({ onHand: 14, reserved: 4 });

    const history = value(
      await readWarehouseMovementHistory(
        h.db,
        f.admin,
        { itemId: f.lot.itemId, kind: "production-output" },
        signal(),
      ),
    );
    expect(history.rows).toMatchObject([
      { id: bulk.eventId, source: "event", onHandDelta: 4, siteId: f.source.siteId },
    ]);
    const eligibleSerials = () =>
      readEligibleBuildOrigins(h.db, f.remote.siteId, [f.parent.itemId]);
    expect((await eligibleSerials()).get(serial.position.id)).toMatchObject({
      releaseId: serialBuild.releaseId,
    });
    value(
      await operate({
        type: "installComponent",
        assemblyPositionId: serial.position.id,
        componentPositionId: receivedLot.id,
        locationId: f.remote.locationId,
        quantity: 1,
      }),
    );
    expect((await eligibleSerials()).has(serial.position.id)).toBe(false);
    expect((await position(h, serial.position.id)).buildOutputId).toBe(serial.buildOutputId);
    await expect(
      h.db
        .update(inventoryStockPositions)
        .set({ buildOutputId: null })
        .where(eq(inventoryStockPositions.id, fresh.id)),
    ).rejects.toThrow();
    await expect(
      h.db
        .update(inventoryStockEvents)
        .set({ onHandDelta: 100 })
        .where(eq(inventoryStockEvents.id, bulk.eventId)),
    ).rejects.toThrow();
    await expect(
      h.db
        .update(inventoryMovements)
        .set({ onHandDelta: 100 })
        .where(
          and(
            eq(inventoryMovements.itemId, f.lot.itemId),
            eq(inventoryMovements.kind, "production-output"),
          ),
        ),
    ).rejects.toThrow();
  } finally {
    await h.close();
  }
});
