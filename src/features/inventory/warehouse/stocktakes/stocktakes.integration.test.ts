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
import { makeTestDb, type TestDb } from "@/test/db";
import { inventoryPartProfiles } from "../../catalog/schema";
import { readPurchasingWorkspace, runPurchasingCommand } from "../../purchasing/service";
import { runInventoryCommand } from "../../service";
import {
  createSourcingActor,
  seedSourcing,
  setRole,
  sourceCommand,
  sourcing,
} from "../../sourcing/sourcing.test-helpers";
import { readWarehouseMovementHistory } from "../operations/reads";
import { runWarehouseOperationsCommand } from "../operations/service";
import { incumbentRows, position, signal } from "../operations/structures.test-helpers";
import type { StocktakeDetail, StocktakeQuery } from "./contracts";
import { inventoryStocktakeLines } from "./countSchema";
import { readStocktakeWorkspace, runStocktakeCommand } from "./service";
import { inventoryValuationLines } from "./valuationSchema";

const denied = { ok: false, error: "unavailable" };
type Fixture = Awaited<ReturnType<typeof seedSourcing>>;

async function workspace(h: TestDb, who: NativeSessionRef, query: StocktakeQuery) {
  const result = await readStocktakeWorkspace(h.db, who, query, signal());
  assert(result.ok);
  return result.value;
}

function command(h: TestDb, who: NativeSessionRef, change: Record<string, unknown>) {
  return runStocktakeCommand(h.db, who, { requestId: randomUUID(), ...change }, signal());
}

async function start(h: TestDb, f: Fixture, who: NativeSessionRef) {
  const result = await command(h, who, {
    type: "startCount",
    locationId: f.source.locationId,
    note: "Dispatch bin cycle count",
  });
  assert(result.ok);
  const { stocktake } = await workspace(h, who, {
    siteId: f.source.siteId,
    stocktakeId: result.id,
  });
  assert(stocktake !== null);
  return stocktake;
}

function observations(stocktake: StocktakeDetail, positionId: string, quantity: number) {
  return stocktake.lines.map((line) => ({
    lineId: line.id,
    countedQuantity: line.positionId === positionId ? quantity : line.expectedOnHand,
    reason: line.positionId === positionId ? "Two units missing on recount" : null,
  }));
}

it("upgrades populated 0136 with incumbent stock, movement and reservation rows unchanged", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 137);
    const f = await seedSourcing(h);
    const before = await incumbentRows(h);
    const recorded = await ledger(h);
    expect(recorded).toHaveLength(137);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    const upgraded = await ledger(h);
    const manifest = await readCanonicalMigrations(canonicalFolder, signal());
    assert(manifest.ok);
    expect(manifest.value[137]?.tag).toBe("0137_inventory_stocktakes");
    expect(upgraded[137]?.hash).toBe(manifest.value[137]?.hash);
    expect(upgraded.slice(0, 137)).toEqual(recorded);
    expect(upgraded).toHaveLength(manifest.value.length);
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

it("reconciles a counted lot with a linked correction, preserves reservations, and rejects changed cohorts", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedSourcing(h);
    const siteId = f.source.siteId;
    const manager = await createSourcingActor(
      h,
      f.admin,
      "Count manager",
      siteId,
      "warehouse_manager",
    );
    const viewer = await createSourcingActor(
      h,
      f.admin,
      "Count observer",
      siteId,
      "warehouse_viewer",
    );
    const remote = await createSourcingActor(
      h,
      f.admin,
      "Remote manager",
      f.remote.siteId,
      "warehouse_manager",
    );
    const draft = await start(h, f, manager);
    const lot = draft.lines.find(({ positionId }) => positionId === f.lot.positionId);
    assert(lot !== undefined);
    expect(lot).toMatchObject({ expectedOnHand: 10, reserved: 4, countedQuantity: null });
    expect(
      await readStocktakeWorkspace(h.db, remote, { siteId, stocktakeId: draft.id }, signal()),
    ).toEqual(denied);
    const setCounts = {
      type: "recordCounts",
      stocktakeId: draft.id,
      expectedVersion: draft.version,
      counts: observations(draft, f.lot.positionId, 8),
    };
    expect(await command(h, viewer, setCounts)).toEqual(denied);
    expect(await command(h, manager, setCounts)).toMatchObject({ ok: true });
    const counted = await workspace(h, viewer, { siteId, stocktakeId: draft.id });
    assert(counted.stocktake !== null);
    expect(counted.stocktake.lines.find(({ id }) => id === lot.id)).toMatchObject({
      countedQuantity: 8,
      countedBy: "Count manager",
      countedAt: expect.any(String),
      reason: "Two units missing on recount",
    });

    const reconcile = {
      type: "reconcileCount",
      stocktakeId: draft.id,
      expectedVersion: counted.stocktake.version,
      requestId: randomUUID(),
    };
    expect(await command(h, manager, reconcile)).toMatchObject({ ok: true, id: draft.id });
    expect(await command(h, manager, reconcile)).toMatchObject({ ok: true, id: draft.id });
    expect(await position(h, f.lot.positionId)).toMatchObject({ onHand: 8, reserved: 4 });
    const closed = (await workspace(h, viewer, { siteId, stocktakeId: draft.id })).stocktake;
    expect(closed).toMatchObject({ status: "reconciled", closedAt: expect.any(String) });
    const adjusted = closed?.lines.find(({ id }) => id === lot.id);
    assert(adjusted?.correctionEventId != null);
    const history = await readWarehouseMovementHistory(
      h.db,
      viewer,
      { kind: "correction" },
      signal(),
    );
    assert(history.ok);
    expect(history.value.rows).toMatchObject([
      { id: adjusted.correctionEventId, positionId: f.lot.positionId, onHandDelta: -2 },
    ]);
    await expect(
      h.db
        .update(inventoryStocktakeLines)
        .set({ countedQuantity: 9 })
        .where(eq(inventoryStocktakeLines.id, lot.id)),
    ).rejects.toThrow();

    const stale = await start(h, f, manager);
    expect(
      await command(h, manager, {
        type: "recordCounts",
        stocktakeId: stale.id,
        expectedVersion: stale.version,
        counts: observations(stale, f.lot.positionId, 7),
      }),
    ).toMatchObject({ ok: true });
    const ready = (await workspace(h, manager, { siteId, stocktakeId: stale.id })).stocktake;
    assert(ready !== null);
    for (const [before, after] of [
      [8, 7],
      [7, 8],
    ] as const) {
      expect(
        await runWarehouseOperationsCommand(
          h.db,
          manager,
          {
            type: "correctStock",
            requestId: randomUUID(),
            positionId: f.lot.positionId,
            locationId: f.source.locationId,
            expectedOnHand: before,
            countedQuantity: after,
            reason: "Separate inventory change after count",
          },
          signal(),
        ),
      ).toMatchObject({ ok: true });
    }
    const incumbent = await incumbentRows(h);
    expect(
      await command(h, manager, {
        type: "reconcileCount",
        stocktakeId: stale.id,
        expectedVersion: ready.version,
      }),
    ).toEqual({ ok: false, error: "stale" });
    expect(await incumbentRows(h)).toEqual(incumbent);

    const reserved = await start(h, f, manager);
    expect(
      await command(h, manager, {
        type: "recordCounts",
        stocktakeId: reserved.id,
        expectedVersion: reserved.version,
        counts: observations(reserved, f.lot.positionId, 3),
      }),
    ).toMatchObject({ ok: true });
    const recorded = (await workspace(h, manager, { siteId, stocktakeId: reserved.id })).stocktake;
    assert(recorded !== null);
    expect(
      await command(h, manager, {
        type: "reconcileCount",
        stocktakeId: recorded.id,
        expectedVersion: recorded.version,
      }),
    ).toEqual({ ok: false, error: "invalid" });
    expect(await incumbentRows(h)).toEqual(incumbent);
    expect(
      await command(h, manager, {
        type: "cancelCount",
        stocktakeId: recorded.id,
        expectedVersion: recorded.version,
        reason: "Resolve reserved units before recounting",
      }),
    ).toMatchObject({ ok: true });
    expect(
      (await workspace(h, viewer, { siteId, stocktakeId: recorded.id })).stocktake,
    ).toMatchObject({
      status: "cancelled",
      closedAt: expect.any(String),
    });
    await setRole(h, f.admin, manager, siteId, "warehouse_manager", false);
    expect(await command(h, manager, reconcile)).toEqual(denied);
  } finally {
    await h.close();
  }
});

it("freezes an exact site valuation with price provenance, reserved units and explicitly unvalued stock", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedSourcing(h);
    const siteId = f.source.siteId;
    await h.db
      .insert(settings)
      .values({ id: true, baseCurrency: "USD" })
      .onConflictDoUpdate({
        target: settings.id,
        set: { baseCurrency: "USD" },
      });
    const counter = await createSourcingActor(
      h,
      f.admin,
      "Warehouse only",
      siteId,
      "warehouse_manager",
    );
    const finance = await createSourcingActor(h, f.admin, "Cost viewer", siteId, "cost_viewer");
    const reviewer = await createSourcingActor(
      h,
      f.admin,
      "Cost and warehouse",
      siteId,
      "warehouse_manager",
      "cost_viewer",
    );
    const bulkScope = { siteId, itemId: f.lot.itemId };
    await h.db
      .update(inventoryPartProfiles)
      .set({ flags: sql`jsonb_set(${inventoryPartProfiles.flags}, '{purchasable}', 'true')` })
      .where(eq(inventoryPartProfiles.itemId, f.lot.itemId));
    expect(
      await sourceCommand(h, f.admin, bulkScope, {
        type: "saveOffer",
        id: null,
        expectedVersion: null,
        supplierOrganizationId: f.firstSupplier,
        manufacturerPartId: null,
        partNumber: "COUNT-VALUATION-25",
        packQuantity: 25,
        approved: true,
        available: true,
      }),
    ).toEqual({ ok: true });
    const sourced = await sourcing(h, f.admin, bulkScope);
    assert(sourced.ok && sourced.value.offers[0] !== undefined);
    const offer = sourced.value.offers[0];
    expect(
      await sourceCommand(h, f.admin, bulkScope, {
        type: "setPriceTier",
        offerId: offer.id,
        minPacks: 1,
        currency: "USD",
        amount: "10.2500",
      }),
    ).toEqual({ ok: true });
    const buy = (body: Record<string, unknown>) =>
      runPurchasingCommand(h.db, f.admin, { requestId: randomUUID(), ...body }, signal());
    const draft = await buy({
      type: "saveDraft",
      id: null,
      expectedVersion: null,
      siteId,
      locationId: f.source.locationId,
      supplierOrganizationId: f.firstSupplier,
      reference: "COUNT-VALUATION-PO",
      expectedDate: null,
      lines: [{ offerId: offer.id, packs: 1 }],
    });
    assert(draft.ok);
    const readOrder = async () => {
      const result = await readPurchasingWorkspace(
        h.db,
        f.admin,
        { siteId, orderId: draft.id },
        signal(),
      );
      assert(result.ok);
      const row = result.value.orders.find(({ id }) => id === draft.id);
      assert(row !== undefined);
      return row;
    };
    expect(
      await buy({ type: "issue", id: draft.id, expectedVersion: (await readOrder()).version }),
    ).toMatchObject({ ok: true });
    const pending = await readOrder();
    const orderLine = pending.lines[0];
    assert(orderLine !== undefined);
    expect(
      await buy({
        type: "receive",
        id: draft.id,
        expectedVersion: pending.version,
        supplierSlip: "PRICE-BASIS-003",
        lines: [
          {
            lineId: orderLine.id,
            quantity: 3,
            lot: "VALUED-RECEIPT",
            serial: null,
            expiryDate: null,
            disposition: "accepted",
            reason: null,
          },
        ],
      }),
    ).toMatchObject({ ok: true });

    expect(
      await sourceCommand(
        h,
        f.admin,
        { siteId, itemId: f.parent.itemId },
        {
          type: "setCostOverride",
          cost: { currency: "USD", amount: "2.1234" },
        },
      ),
    ).toEqual({ ok: true });
    expect(
      await sourceCommand(
        h,
        f.admin,
        { siteId, itemId: f.child.itemId },
        {
          type: "setCostOverride",
          cost: { currency: "EUR", amount: "8.1234" },
        },
      ),
    ).toEqual({ ok: true });
    const capture = {
      type: "captureValuation",
      siteId,
      label: "November value",
      requestId: randomUUID(),
    };
    expect(await command(h, counter, capture)).toEqual(denied);
    expect(await command(h, finance, capture)).toEqual(denied);
    const saved = await command(h, reviewer, capture);
    assert(saved.ok);
    expect(await command(h, reviewer, capture)).toEqual(saved);
    expect(await workspace(h, counter, { siteId })).not.toHaveProperty("valuationAccess");
    const query = { siteId, valuationId: saved.id };
    const historical = (await workspace(h, finance, query)).valuationAccess?.valuation;
    assert(historical != null);
    expect(historical).toMatchObject({
      currency: "USD",
      quantity: 15,
      reserved: 4,
      unvaluedQuantity: 11,
      totalValue: "3.3534",
    });
    expect(historical.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          positionId: f.parent.positionId,
          source: "override",
          value: "2.1234",
        }),
        expect.objectContaining({
          lot: "VALUED-RECEIPT",
          source: "purchase_receipt",
          quantity: 3,
          value: "1.2300",
          basisPackQuantity: 25,
        }),
        expect.objectContaining({
          positionId: f.lot.positionId,
          source: "unvalued",
          reserved: 4,
          value: null,
        }),
        expect.objectContaining({
          positionId: f.child.positionId,
          source: "unvalued",
          value: null,
        }),
      ]),
    );
    expect(
      await sourceCommand(
        h,
        f.admin,
        { siteId, itemId: f.parent.itemId },
        {
          type: "setCostOverride",
          cost: { currency: "USD", amount: "20" },
        },
      ),
    ).toEqual({ ok: true });
    expect((await workspace(h, finance, query)).valuationAccess?.valuation).toEqual(historical);
    expect(await readStocktakeWorkspace(h.db, counter, query, signal())).toEqual(denied);
    await h.db
      .update(inventoryPartProfiles)
      .set({ visibility: "admin" })
      .where(eq(inventoryPartProfiles.itemId, f.parent.itemId));
    expect(await readStocktakeWorkspace(h.db, finance, query, signal())).toEqual(denied);
    expect((await workspace(h, finance, { siteId })).valuationAccess?.valuations).toEqual([]);
    await h.db
      .update(inventoryPartProfiles)
      .set({ visibility: "staff" })
      .where(eq(inventoryPartProfiles.itemId, f.parent.itemId));
    await expect(
      h.db
        .update(inventoryValuationLines)
        .set({ value: "99" })
        .where(eq(inventoryValuationLines.snapshotId, saved.id)),
    ).rejects.toThrow();
    await setRole(h, f.admin, finance, siteId, "cost_viewer", false);
    expect(await readStocktakeWorkspace(h.db, finance, query, signal())).toEqual(denied);
  } finally {
    await h.close();
  }
});
