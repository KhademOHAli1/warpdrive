import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { createSourcingActor, setRole } from "@/features/inventory/sourcing/sourcing.test-helpers";
import { actor, signal } from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { runLabelCommand } from "@/features/physical-labels/service";
import { makeTestDb, type TestDb } from "@/test/db";
import type { AssetIntent } from "../../contracts";
import { assetCustodians, assetCustodyHistory, assetCustodyHoldings } from "../../custody/schema";
import { assetBalances, assetRecords } from "../../schema";
import { runAssetCommand } from "../../service";
import type { BookingLine, BookingStatus, BookingWindow } from "../contracts";
import { runBookingMembershipCommand } from "../membershipService";
import { assetBookingEvents, assetBookingLines, assetBookings } from "../schema";
import { checkBookingAvailability } from "../service";
import type {
  BookingCheckInItem,
  BookingHandoverCommand,
  BookingHandoverIntent,
  BookingHandoverView,
  BookingHandoverWrite,
} from "./contracts";
import { handoverLineKey } from "./fixtureState";
import {
  assetBookingHandoverAllocations,
  assetBookingHandoverInspections,
  assetBookingHandoverReceipts,
} from "./schema";
import { lookupBookingHandoverEquipment, readBookingHandover, runBookingHandover } from "./service";

const origin = "https://equipment.example.test";
const unavailable = { ok: false, error: "unavailable" } as const;
const capacity = { ok: false, error: "capacity" } as const;
const hour = 3_600_000;

function result<T>(value: T | undefined): T {
  assert(value !== undefined);
  return value;
}

function accepted(result: BookingHandoverWrite) {
  assert(result.ok);
  return result;
}

function handle(
  db: Db,
  who: NativeSessionRef,
  input: BookingHandoverIntent,
  requestId = randomUUID(),
) {
  return runBookingHandover(db, who, { ...input, requestId }, signal());
}

function commandVersion({ bookingId, bookingVersion, version }: BookingHandoverView) {
  return { bookingId, bookingVersion, handoverVersion: version };
}

async function asset(h: TestDb, who: NativeSessionRef, intent: AssetIntent) {
  const response = await runAssetCommand(
    h.db,
    who,
    { ...intent, requestId: randomUUID() },
    signal(),
  );
  assert(response.ok);
  return result(response.value.records.find(({ id }) => id === response.focusId));
}

async function registerEquipment(
  h: TestDb,
  who: NativeSessionRef,
  {
    siteId,
    locationId,
    code,
    tracking,
    openingQuantity,
    serial,
  }: {
    siteId: string;
    locationId: string;
    code: string;
    tracking: "returnable_pool" | "individual";
    openingQuantity: number;
    serial: string | null;
  },
) {
  return asset(h, who, {
    type: "create",
    siteId,
    locationId,
    code,
    tracking,
    openingQuantity,
    serial,
    modelId: null,
    name: code,
    description: null,
    categoryId: null,
    tags: [],
    fieldValues: {},
  });
}

function demand(
  kind: "asset" | "returnable_pool",
  record: { id: string; name: string; code: string },
  locationId: string,
  bin: string,
  quantity: number,
  serial: string | null,
): BookingLine {
  return {
    kind,
    resourceId: record.id,
    locationId,
    bin,
    quantity,
    serial,
    name: record.name,
    code: record.code,
    contents: [],
    kitDefinitionVersion: null,
  };
}

async function persistConfirmed(
  db: Db,
  siteId: string,
  requesterId: string,
  title: string,
  window: BookingWindow,
  lines: BookingLine[],
) {
  const bookingId = randomUUID();
  const at = new Date(Date.parse(window.startAt) - hour);
  await db.transaction(async (tx) => {
    await tx.insert(assetBookings).values({
      id: bookingId,
      siteId,
      title,
      requesterId,
      requesterRole: "base",
      requesterName: "Process requester",
      startAt: new Date(window.startAt),
      endAt: new Date(window.endAt),
      status: "draft",
      version: 1,
      updatedAt: at,
    });
    await tx.insert(assetBookingLines).values(
      lines.map(({ resourceId, ...line }, position) => ({
        ...line,
        bookingId,
        siteId,
        position,
        assetId: resourceId,
      })),
    );
    const stages = [
      { version: 1, status: "draft", kind: "created" },
      { version: 2, status: "pending", kind: "submitted" },
      { version: 3, status: "confirmed", kind: "approved" },
    ] as const satisfies { version: number; status: BookingStatus; kind: string }[];
    for (const { version, status, kind } of stages) {
      if (version > 1) {
        await tx
          .update(assetBookings)
          .set({ version, status })
          .where(eq(assetBookings.id, bookingId));
      }
      await tx.insert(assetBookingEvents).values({
        bookingId,
        siteId,
        at,
        version,
        kind,
        actorId: requesterId,
        snapshot: { title, window, lines, status, archived: false },
      });
    }
  });
  return bookingId;
}

async function fixture(h: TestDb) {
  const { db } = h;
  const admin = await actor(h, "Handover administrator", true);
  const siteId = randomUUID();
  const foreignSite = randomUUID();
  const source = randomUUID();
  const recovery = randomUUID();
  const outsideBin = randomUUID();
  await db.insert(directorySites).values([
    { id: siteId, name: "Process floor", code: "PROCESS" },
    { id: foreignSite, name: "Outside site", code: "OUTSIDE" },
  ]);
  await db.insert(directoryLocations).values([
    { id: source, siteId, name: "Source", code: "SOURCE" },
    { id: recovery, siteId, name: "Recovery", code: "RECOVERY" },
    { id: outsideBin, siteId: foreignSite, name: "Foreign bin", code: "FOREIGN" },
  ]);
  const manager = await createSourcingActor(
    h,
    admin,
    "Scoped handover manager",
    siteId,
    "asset_manager",
  );
  const outsider = await createSourcingActor(
    h,
    admin,
    "Other site operator",
    foreignSite,
    "asset_manager",
  );
  const requester = await actor(h, "Process requester");
  const membership = await runBookingMembershipCommand(
    db,
    admin,
    {
      requestId: randomUUID(),
      siteId,
      userId: requester.userId,
      role: "base",
    },
    signal(),
  );
  assert(membership.ok);
  const custodianId = randomUUID();
  await db.insert(assetCustodians).values({
    id: custodianId,
    siteId,
    name: "Test technician",
    kind: "non_login",
    version: 1,
  });
  const firstPool = await registerEquipment(h, manager, {
    siteId,
    locationId: source,
    code: "LEADS",
    tracking: "returnable_pool",
    openingQuantity: 8,
    serial: null,
  });
  const pool = await asset(h, manager, {
    type: "changePool",
    assetId: firstPool.id,
    version: firstPool.version,
    operation: "restock",
    quantity: 6,
    locationId: recovery,
    toLocationId: null,
    reason: "Initial test recovery stock",
  });
  const serial = "UNIT-001";
  const meter = await registerEquipment(h, manager, {
    siteId,
    locationId: source,
    code: "METER",
    tracking: "individual",
    openingQuantity: 0,
    serial,
  });
  const outside = await registerEquipment(h, outsider, {
    siteId: foreignSite,
    locationId: outsideBin,
    code: "OTHER-METER",
    tracking: "individual",
    openingQuantity: 0,
    serial: "UNIT-002",
  });
  const label = await runLabelCommand(
    db,
    manager,
    {
      type: "issue",
      requestId: randomUUID(),
      target: { kind: "asset", id: meter.id },
    },
    signal(),
  );
  assert(label.ok);
  const printedCode = result(label.value.labels.find(({ id }) => id === label.focusId)).value;
  const now = Date.now();
  const window = {
    startAt: new Date(now - hour).toISOString(),
    endAt: new Date(now + hour).toISOString(),
  };
  const sourceLine = demand("returnable_pool", pool, source, "Source", 3, null);
  const recoveryLine = demand("returnable_pool", pool, recovery, "Recovery", 2, null);
  const meterLine = demand("asset", meter, source, "Source", 1, serial);
  const bookingId = await persistConfirmed(
    db,
    siteId,
    requester.userId,
    "Commissioning desk",
    window,
    [sourceLine, recoveryLine, meterLine],
  );
  await persistConfirmed(
    db,
    siteId,
    requester.userId,
    "Competing meter loan",
    {
      startAt: new Date(now + 1.5 * hour).toISOString(),
      endAt: new Date(now + 3 * hour).toISOString(),
    },
    [meterLine],
  );
  return {
    admin,
    manager,
    requester,
    outsider,
    outside,
    siteId,
    source,
    recovery,
    custodianId,
    pool,
    meter,
    printedCode,
    serial,
    bookingId,
    sourceLine,
    recoveryLine,
    meterLine,
    window,
    now,
  };
}

function balances(db: Db, pool: string) {
  return db
    .select({ bin: assetBalances.locationId, quantity: assetBalances.quantity })
    .from(assetBalances)
    .where(eq(assetBalances.assetId, pool));
}

it("qualifies scoped native booking pickup, pooled stock, checkout replay and retained return receipts", async () => {
  const h = await makeTestDb();
  try {
    const { db } = h;
    const f = await fixture(h);
    const { manager, requester, outsider, bookingId, siteId, source, recovery } = f;
    const initial = await readBookingHandover(db, manager, bookingId, signal());
    assert(initial.ok);
    expect(initial.value).toMatchObject({
      status: "ready",
      canOperate: true,
      version: 0,
      bookingVersion: 3,
    });
    expect(await readBookingHandover(db, requester, bookingId, signal())).toMatchObject({
      ok: true,
      value: { canOperate: false, custodians: [], locations: [] },
    });
    expect(await readBookingHandover(db, outsider, bookingId, signal())).toEqual(unavailable);
    expect(
      await lookupBookingHandoverEquipment(db, manager, bookingId, f.printedCode, origin, signal()),
    ).toEqual({ ok: true, id: f.meter.id, kind: "asset" });
    expect(
      await lookupBookingHandoverEquipment(
        db,
        manager,
        bookingId,
        f.outside.code,
        origin,
        signal(),
      ),
    ).toEqual(unavailable);
    expect(
      await lookupBookingHandoverEquipment(db, requester, bookingId, f.serial, origin, signal()),
    ).toEqual(unavailable);
    const pickup: BookingHandoverCommand = {
      ...commandVersion(initial.value),
      type: "pickup",
      requestId: randomUUID(),
      custodianId: f.custodianId,
      items: [f.sourceLine, f.recoveryLine].map((line) => ({
        lineKey: handoverLineKey(line),
        targetId: f.pool.id,
        quantity: 2,
      })),
      keepPickupOpen: true,
      note: "Two distinct source bins",
    };
    expect(await runBookingHandover(db, requester, pickup, signal())).toEqual(unavailable);
    const [issued, replay] = await Promise.all([
      runBookingHandover(db, manager, pickup, signal()),
      runBookingHandover(db, manager, pickup, signal()),
    ]);
    const first = accepted(issued);
    expect(accepted(replay).value.receipts).toEqual(first.value.receipts);
    expect(first.value).toMatchObject({ status: "ongoing", pickupClosed: false, version: 1 });
    expect(await balances(db, f.pool.id)).toEqual(
      expect.arrayContaining([
        { bin: source, quantity: 6 },
        { bin: recovery, quantity: 4 },
      ]),
    );
    const movements = await db
      .select()
      .from(assetCustodyHistory)
      .where(eq(assetCustodyHistory.assetId, f.pool.id))
      .orderBy(asc(assetCustodyHistory.version));
    expect(movements).toMatchObject([
      { action: "assign", version: f.pool.version + 1, sourceLocationId: source, quantity: 2 },
      { action: "assign", version: f.pool.version + 2, sourceLocationId: recovery, quantity: 2 },
    ]);
    const liveHolding = result(movements[0]).holdingId;
    await expect(
      db.delete(assetCustodyHoldings).where(eq(assetCustodyHoldings.id, liveHolding)),
    ).rejects.toMatchObject({
      cause: { code: "23514", message: "booking custody must settle through its handover" },
    });
    await expect(
      db
        .update(assetBookingHandoverReceipts)
        .set({ requestId: randomUUID() })
        .where(eq(assetBookingHandoverReceipts.bookingId, bookingId)),
    ).rejects.toMatchObject({
      cause: { code: "23514", message: "booking handover receipts are fixed" },
    });
    expect(
      await runBookingHandover(db, manager, { ...pickup, note: "Conflicting retry" }, signal()),
    ).toEqual({ ok: false, error: "conflict" });
    expect(
      await runBookingHandover(db, manager, { ...pickup, requestId: randomUUID() }, signal()),
    ).toEqual({ ok: false, error: "stale" });
    await setRole(h, f.admin, manager, siteId, "asset_manager", false);
    expect(await runBookingHandover(db, manager, pickup, signal())).toEqual(unavailable);
    await setRole(h, f.admin, manager, siteId, "asset_manager");

    const staged = accepted(
      await handle(db, manager, {
        ...commandVersion(first.value),
        type: "pickup",
        custodianId: f.custodianId,
        items: [
          { lineKey: handoverLineKey(f.sourceLine), targetId: f.pool.id, quantity: 1 },
          { lineKey: handoverLineKey(f.meterLine), targetId: f.meter.id, quantity: 1 },
        ],
        keepPickupOpen: false,
        note: null,
      }),
    );
    const serialAllocation = result(
      staged.value.allocations.find(({ targetId }) => targetId === f.meter.id),
    );
    expect(serialAllocation).toMatchObject({ serial: f.serial, outstanding: 1 });
    expect(
      await db
        .select()
        .from(assetCustodyHoldings)
        .where(eq(assetCustodyHoldings.assetId, f.meter.id)),
    ).toMatchObject([{ custodianId: f.custodianId, quantity: 1 }]);
    expect(
      await handle(db, manager, {
        ...commandVersion(staged.value),
        type: "amendDue",
        dueAt: new Date(f.now + 2 * hour).toISOString(),
        reason: "Would overlap the next serial pickup",
      }),
    ).toEqual(capacity);
    const during = await readBookingHandover(db, manager, bookingId, signal());
    expect(during).toMatchObject({ ok: true, value: { dueAt: f.window.endAt, version: 2 } });
    const changed = accepted(
      await handle(db, manager, {
        ...commandVersion(staged.value),
        type: "amendDue",
        dueAt: new Date(f.now + 1.25 * hour).toISOString(),
        reason: "Finishing calibration",
      }),
    );
    expect(changed.booking.window.endAt).toBe(new Date(f.now + 1.25 * hour).toISOString());

    const partialAllocation = result(
      changed.value.allocations.find(
        ({ sourceLocationId, targetId, outstanding }) =>
          sourceLocationId === source && targetId === f.pool.id && outstanding === 2,
      ),
    );
    const partial = accepted(
      await handle(db, manager, {
        ...commandVersion(changed.value),
        type: "checkIn",
        note: "Damaged cable returned separately",
        items: [
          {
            kind: "equipment",
            allocationId: partialAllocation.id,
            condition: "damaged",
            locationId: recovery,
            quantity: 1,
          },
        ],
      }),
    );
    const checkInReceipt = result(partial.value.receipts[0]);
    expect(checkInReceipt).toMatchObject({
      kind: "checkIn",
      bookingTitle: "Commissioning desk",
      siteName: "Process floor",
      items: [
        {
          targetId: f.pool.id,
          quantity: 1,
          disposition: "damaged",
          sourceBin: "Source",
          destinationBin: "Recovery",
        },
      ],
    });
    expect(checkInReceipt.remaining).toContainEqual(
      expect.objectContaining({
        targetId: f.meter.id,
        serial: f.serial,
        quantity: 1,
      }),
    );
    expect(await db.select().from(assetBookingHandoverInspections)).toMatchObject([
      {
        allocationId: partialAllocation.id,
        targetId: f.pool.id,
        locationId: recovery,
        condition: "damaged",
        quantity: 1,
      },
    ]);
    const remaining: BookingCheckInItem[] = partial.value.allocations
      .filter(({ outstanding }) => outstanding > 0)
      .map(({ id, outstanding, sourceLocationId }) => ({
        kind: "equipment",
        allocationId: id,
        condition: "good",
        quantity: outstanding,
        locationId: sourceLocationId ?? source,
      }));
    const finished = accepted(
      await handle(db, manager, {
        ...commandVersion(partial.value),
        type: "checkIn",
        note: null,
        items: remaining,
      }),
    );
    expect(finished.value.status).toBe("completed");
    expect(finished.value.receipts).toContainEqual(checkInReceipt);
    expect(await db.select().from(assetCustodyHoldings)).toEqual([]);
    expect(await balances(db, f.pool.id)).toEqual(
      expect.arrayContaining([
        { bin: source, quantity: 7 },
        { bin: recovery, quantity: 7 },
      ]),
    );
    expect(await db.select().from(assetBookingHandoverAllocations)).toHaveLength(4);
    expect(await db.select().from(assetBookingHandoverReceipts)).toHaveLength(5);
    expect(
      await db
        .select({ locationId: assetRecords.locationId })
        .from(assetRecords)
        .where(eq(assetRecords.id, f.meter.id)),
    ).toEqual([{ locationId: source }]);
    expect(
      await checkBookingAvailability(
        db,
        manager,
        {
          siteId,
          bookingId: null,
          window: {
            startAt: new Date(f.now + 4 * hour).toISOString(),
            endAt: new Date(f.now + 5 * hour).toISOString(),
          },
          lines: [
            { kind: "returnable_pool", resourceId: f.pool.id, locationId: recovery, quantity: 7 },
          ],
        },
        signal(),
      ),
    ).toEqual(capacity);
  } finally {
    await h.close();
  }
});
