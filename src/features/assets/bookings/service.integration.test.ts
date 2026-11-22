import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
} from "@/db/migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "@/db/migrationAdmissionSource";
import { users } from "@/db/schema/identity";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { createSourcingActor } from "@/features/inventory/sourcing/sourcing.test-helpers";
import {
  actor,
  incumbentRows,
  seedStructures,
  signal,
  command as warehouse,
} from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { readOperationsAccessWorkspace } from "@/features/operations-access/service";
import { makeTestDb, type TestDb } from "@/test/db";
import type { AssetIntent } from "../contracts";
import type { CustodyIntent } from "../custody/contracts";
import { assetCustodians, assetCustodyHistory, assetCustodyHoldings } from "../custody/schema";
import { runAssetCustodyCommand } from "../custody/service";
import { assetKitActivity, assetKitDefinitions, assetKitMembers, assetKits } from "../kits/schema";
import { runKitCommand } from "../kits/service";
import { assetEvents, assetRecords } from "../schema";
import { runAssetCommand } from "../service";
import type {
  Booking,
  BookingDemand,
  BookingIntent,
  BookingResult,
  BookingWindow,
} from "./contracts";
import type { BookingMembershipRole } from "./membershipContracts";
import { readBookingMemberships, runBookingMembershipCommand } from "./membershipService";
import {
  assetBookingEvents,
  assetBookingLines,
  assetBookingReceipts,
  assetBookings,
} from "./schema";
import { checkBookingAvailability, readBookingWorkspace, runBookingCommand } from "./service";

type WarehouseSeed = Awaited<ReturnType<typeof seedStructures>>;
type Endpoint = WarehouseSeed["source"];
const unavailable = { ok: false, error: "unavailable" } as const;
const noCapacity = { ok: false, error: "capacity" } as const;

function selected<T>(result: T | undefined): T {
  assert(result !== undefined);
  return result;
}

function accepted(result: BookingResult) {
  assert(result.ok);
  return result.value;
}

function booked(result: BookingResult) {
  assert(result.ok && result.bookingId !== null);
  return selected(result.value.bookings.find(({ id }) => id === result.bookingId));
}

function command(
  h: TestDb,
  who: NativeSessionRef,
  intent: BookingIntent,
  requestId = randomUUID(),
) {
  return runBookingCommand(h.db, who, { ...intent, requestId }, signal());
}

function membership(
  h: TestDb,
  who: NativeSessionRef,
  siteId: string,
  userId: string,
  role: BookingMembershipRole | null,
  requestId = randomUUID(),
) {
  return runBookingMembershipCommand(h.db, who, { siteId, userId, role, requestId }, signal());
}

function asset(h: TestDb, who: NativeSessionRef, intent: AssetIntent, requestId = randomUUID()) {
  return runAssetCommand(h.db, who, { ...intent, requestId }, signal());
}

function custody(h: TestDb, who: NativeSessionRef, intent: CustodyIntent) {
  return runAssetCustodyCommand(h.db, who, { ...intent, requestId: randomUUID() }, signal());
}

function slot(offset = 0): BookingWindow {
  const start = Date.now() + (72 + offset) * 3_600_000;
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(start + 3_600_000).toISOString(),
  };
}

function target({ id, siteId, version }: Booking) {
  return { siteId, bookingId: id, version };
}

function intent(
  who: NativeSessionRef,
  siteId: string,
  window: BookingWindow,
  demand: BookingDemand,
  title = "Calibrated engineering equipment",
) {
  return {
    type: "saveBooking",
    siteId,
    bookingId: null,
    version: null,
    requesterId: who.userId,
    title,
    description: null,
    window,
    lines: [demand],
  } satisfies BookingIntent;
}

function submit(h: TestDb, who: NativeSessionRef, booking: Booking, requestId = randomUUID()) {
  return command(h, who, { type: "submitBooking", ...target(booking) }, requestId);
}

function review(
  h: TestDb,
  who: NativeSessionRef,
  booking: Booking,
  decision: "approve" | "request_changes",
  requestId = randomUUID(),
) {
  return command(
    h,
    who,
    {
      type: "reviewBooking",
      ...target(booking),
      decision,
      reason: decision === "request_changes" ? "Verify the pickup time" : null,
    },
    requestId,
  );
}

function metadata(at: Endpoint, code: string) {
  return {
    siteId: at.siteId,
    code,
    name: code,
    description: null,
    categoryId: null,
    tags: [],
    fieldValues: {},
  };
}

async function createMeter(
  h: TestDb,
  who: NativeSessionRef,
  at: Endpoint,
  code: string,
  modelId: string | null = null,
) {
  const result = await asset(h, who, {
    ...metadata(at, code),
    type: "create",
    tracking: "individual",
    serial: code,
    modelId,
    locationId: at.locationId,
    openingQuantity: 0,
  });
  assert(result.ok && result.focusId !== null);
  return selected(result.value.records.find(({ id }) => id === result.focusId));
}

async function seedPriorEquipment(h: TestDb, { admin, source }: WarehouseSeed) {
  // Use the exact 0146 columns and retained events. Current domain routes also read
  // booking tables, which do not exist while this historical prefix is populated.
  const packedId = randomUUID();
  const heldId = randomUUID();
  const kitId = randomUUID();
  const holdingId = randomUUID();
  const custodianId = randomUUID();
  const eventId = randomUUID();
  const at = new Date("2026-11-10T15:00:00.000Z");
  const { siteId, locationId } = source;
  const actorId = admin.userId;
  const custodianName = "Incumbent service technician";
  const line = {
    id: randomUUID(),
    mode: "individual",
    assetId: packedId,
    modelId: null,
    quantity: 1,
    packedQuantity: 1,
    sourceLocationId: null,
  } as const;
  await h.db.transaction(async (tx) => {
    for (const [id, code] of [
      [packedId, "KIT-METER-0146"],
      [heldId, "HELD-METER-0146"],
    ] as const) {
      await tx.insert(assetRecords).values({
        id,
        siteId,
        locationId,
        code,
        codeKey: code.toLowerCase(),
        name: code,
        tracking: "individual",
        version: 1,
        serial: code,
        serialKey: code.toLowerCase(),
      });
      await tx
        .insert(assetEvents)
        .values({ assetId: id, siteId, actorId, locationId, version: 1, at, kind: "created" });
    }
    await tx.insert(assetKits).values({
      id: kitId,
      siteId,
      locationId,
      code: "SERVICE-146",
      codeKey: "service-146",
      name: "Incumbent calibration kit",
      version: 1,
      definitionVersion: 1,
    });
    await tx.insert(assetKitDefinitions).values({
      siteId,
      kitId,
      definitionVersion: 1,
      snapshot: {
        code: "SERVICE-146",
        name: "Incumbent calibration kit",
        locationId,
        lines: [line],
      },
    });
    await tx.insert(assetKitMembers).values({ ...line, kitId, siteId });
    await tx.insert(assetKitActivity).values({
      id: randomUUID(),
      kitId,
      siteId,
      locationId,
      kind: "created",
      version: 1,
      actorId,
      at,
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
      assetId: heldId,
      tracking: "individual",
      custodianId,
      custodianName,
      sourceLocationId: locationId,
      locationId,
      quantity: 1,
      condition: "good",
      assignedAt: at,
    });
    await tx.update(assetRecords).set({ version: 2 }).where(eq(assetRecords.id, heldId));
    await tx.insert(assetEvents).values({
      id: eventId,
      assetId: heldId,
      siteId,
      actorId,
      at,
      locationId,
      kind: "updated",
      version: 2,
      quantity: 1,
    });
    await tx.insert(assetCustodyHistory).values({
      id: eventId,
      siteId,
      assetId: heldId,
      version: 2,
      action: "assign",
      holdingId,
      toCustodianId: custodianId,
      toCustodianName: custodianName,
      quantity: 1,
      sourceLocationId: locationId,
      locationId,
      condition: "good",
    });
  });
  return { packedId, heldId, kitId, holdingId, eventId };
}

async function historicalSnapshot(h: TestDb) {
  const [stock, assets, events, kits, definitions, members, holdings, custodyHistory] =
    await Promise.all([
      incumbentRows(h),
      h.db.select().from(assetRecords).orderBy(asc(assetRecords.id)),
      h.db.select().from(assetEvents).orderBy(asc(assetEvents.id)),
      h.db.select().from(assetKits).orderBy(asc(assetKits.id)),
      h.db.select().from(assetKitDefinitions).orderBy(asc(assetKitDefinitions.kitId)),
      h.db.select().from(assetKitMembers).orderBy(asc(assetKitMembers.id)),
      h.db.select().from(assetCustodyHoldings).orderBy(asc(assetCustodyHoldings.id)),
      h.db.select().from(assetCustodyHistory).orderBy(asc(assetCustodyHistory.id)),
    ]);
  return { stock, assets, events, kits, definitions, members, holdings, custodyHistory };
}

it("upgrades populated 0146 kit, custody and Inventory rows and books an existing kit version", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 147);
    const seed = await seedStructures(h);
    const prior = await seedPriorEquipment(h, seed);
    const before = await historicalSnapshot(h);
    const prefix = await ledger(h);
    expect(prefix).toHaveLength(147);
    expect(before.stock.allocations).toMatchObject([{ quantity: 4 }]);
    expect(before.members).toMatchObject([{ kitId: prior.kitId, assetId: prior.packedId }]);
    expect(before.holdings).toMatchObject([{ id: prior.holdingId, assetId: prior.heldId }]);

    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    const canonical = await readCanonicalMigrations(canonicalFolder, signal());
    assert(canonical.ok);
    const applied = await ledger(h);
    expect(applied.slice(0, 147)).toEqual(prefix);
    expect(applied).toHaveLength(canonical.value.length);
    expect(canonical.value[147]?.tag).toBe("0147_asset_bookings");
    expect(canonical.value[147]?.hash).toBe(applied[147]?.hash);
    expect(await historicalSnapshot(h)).toEqual(before);

    const { admin, source, recovery } = seed;
    const draft = booked(
      await command(
        h,
        admin,
        intent(admin, source.siteId, slot(), {
          kind: "kit",
          resourceId: prior.kitId,
          locationId: source.locationId,
          quantity: 1,
        }),
      ),
    );
    const reserved = booked(await submit(h, admin, draft));
    expect(reserved).toMatchObject({
      status: "confirmed",
      lines: [
        {
          resourceId: prior.kitId,
          kitDefinitionVersion: 1,
          locationId: source.locationId,
          contents: [{ code: "KIT-METER-0146", quantity: 1 }],
        },
      ],
    });
    expect(
      await h.db.select().from(assetBookingLines).where(eq(assetBookingLines.bookingId, draft.id)),
    ).toMatchObject([{ kitId: prior.kitId, kitDefinitionVersion: 1, siteId: source.siteId }]);
    expect(
      await runKitCommand(
        h.db,
        admin,
        {
          type: "moveKit",
          requestId: randomUUID(),
          kitId: prior.kitId,
          siteId: source.siteId,
          version: 1,
          locationId: recovery.locationId,
          note: null,
        },
        signal(),
      ),
    ).toEqual({ ok: false, error: "held" });
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    expect(await ledger(h)).toEqual(applied);
    expect(await historicalSnapshot(h)).toEqual(before);
  } finally {
    await h.close();
  }
});

async function setup(h: TestDb) {
  const seed = await seedStructures(h);
  const { admin, source, remote } = seed;
  const { siteId } = source;
  const base = await actor(h, "Base booking member");
  const self = await actor(h, "Self-service booking member");
  const guest = await actor(h, "Projects-only guest");
  await h.db.update(users).set({ projectsGuestOnly: true }).where(eq(users.id, guest.userId));
  const manager = await createSourcingActor(h, admin, "Equipment manager", siteId, "asset_manager");
  const viewer = await createSourcingActor(h, admin, "Equipment viewer", siteId, "asset_viewer");
  const warehouseOnly = await createSourcingActor(
    h,
    admin,
    "Warehouse only",
    siteId,
    "warehouse_manager",
  );
  const foreign = await actor(h, "Remote requester");
  const oldOperations = await readOperationsAccessWorkspace(h.db, admin, signal());
  assert(oldOperations.ok);
  const baseGrant = randomUUID();
  expect(await membership(h, manager, siteId, base.userId, "base")).toEqual(unavailable);
  expect(await membership(h, admin, siteId, guest.userId, "base")).toEqual({
    ok: false,
    error: "invalid",
  });
  const granted = await membership(h, admin, siteId, base.userId, "base", baseGrant);
  assert(granted.ok);
  expect(await membership(h, admin, siteId, base.userId, "base", baseGrant)).toEqual(granted);
  expect(await membership(h, admin, siteId, base.userId, "self_service", baseGrant)).toEqual({
    ok: false,
    error: "conflict",
  });
  for (const [person, targetSite] of [
    [self, siteId],
    [foreign, remote.siteId],
  ] as const) {
    expect(await membership(h, admin, targetSite, person.userId, "self_service")).toMatchObject({
      ok: true,
    });
  }
  expect(await readBookingMemberships(h.db, manager, signal())).toEqual(unavailable);
  expect(await readOperationsAccessWorkspace(h.db, admin, signal())).toEqual(oldOperations);

  const state = accepted(await readBookingWorkspace(h.db, admin, signal()));
  const site = selected(state.sites.find(({ id }) => id === siteId));
  const policy = {
    type: "savePolicy",
    siteId,
    version: site.policyVersion,
    policy: { ...site.policy, baseApproval: true },
  } satisfies BookingIntent;
  expect(await command(h, manager, policy)).toEqual(unavailable);
  expect(await command(h, admin, policy)).toMatchObject({ ok: true });
  const createdModel = await asset(h, manager, {
    ...metadata(source, "BOOKABLE-METER"),
    type: "saveModel",
    modelId: null,
    version: null,
  });
  assert(createdModel.ok);
  const modelId = selected(
    createdModel.value.models.find(({ code }) => code === "BOOKABLE-METER"),
  ).id;
  const exact = await createMeter(h, manager, source, "BOOKABLE-METER-A", modelId);
  await createMeter(h, manager, source, "BOOKABLE-METER-B", modelId);
  const unrelated = await createMeter(h, manager, source, "NO-BOOKING-CONFLICT");
  return {
    ...seed,
    base,
    self,
    manager,
    viewer,
    warehouseOnly,
    foreign,
    guest,
    baseGrant,
    modelId,
    exact,
    unrelated,
  };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

function exactDemand(f: Fixture): BookingDemand {
  return { kind: "asset", resourceId: f.exact.id, locationId: f.source.locationId, quantity: 1 };
}

async function deniedScopes(h: TestDb, f: Fixture, window: BookingWindow) {
  for (const who of [f.viewer, f.warehouseOnly, f.foreign, f.guest]) {
    expect(await command(h, who, intent(who, f.source.siteId, window, exactDemand(f)))).toEqual(
      unavailable,
    );
  }
  expect(await readBookingWorkspace(h.db, f.guest, signal())).toEqual(unavailable);
  const unrelated = accepted(await readBookingWorkspace(h.db, f.warehouseOnly, signal()));
  expect(unrelated.sites).toEqual([]);
  expect(unrelated.bookings).toEqual([]);
}

async function legacyGuards(h: TestDb, f: Fixture) {
  const target = { assetId: f.exact.id, version: f.exact.version };
  expect(
    await asset(h, f.manager, {
      ...target,
      type: "move",
      locationId: f.recovery.locationId,
      reason: "Would break dated pickup",
    }),
  ).toEqual({ ok: false, error: "state" });
  const recipient = await custody(h, f.manager, {
    type: "saveCustodian",
    siteId: f.source.siteId,
    custodianId: null,
    version: null,
    staffId: null,
    name: "Workshop handover",
    active: true,
  });
  assert(recipient.ok);
  const custodian = selected(recipient.value.custody?.custodians[0]);
  const delivered = await custody(h, f.manager, {
    type: "bulkAssign",
    siteId: f.source.siteId,
    custodianId: custodian.id,
    condition: "good",
    note: null,
    locationId: null,
    assets: [target, { assetId: f.unrelated.id, version: f.unrelated.version }],
  });
  assert(delivered.ok);
  expect(delivered.outcomes).toEqual([
    { assetId: f.exact.id, ok: false, error: "held" },
    { assetId: f.unrelated.id, ok: true },
  ]);
  expect(delivered.value.custody?.holdings).toMatchObject([{ assetId: f.unrelated.id }]);
  expect(
    await warehouse(h, f.warehouseOnly, {
      type: "correctStock",
      positionId: f.lot.positionId,
      locationId: f.source.locationId,
      expectedOnHand: 10,
      countedQuantity: 9,
      reason: "Independent stock recount",
    }),
  ).toMatchObject({ ok: true });
}

async function moderation(h: TestDb, f: Fixture, pending: Booking, competitor: Booking) {
  expect(await review(h, f.base, pending, "approve")).toEqual(unavailable);
  const sentBack = booked(await review(h, f.manager, pending, "request_changes"));
  expect(sentBack).toMatchObject({
    status: "draft",
    history: [
      expect.objectContaining({ kind: "sent_back", reason: "Verify the pickup time" }),
      expect.anything(),
      expect.anything(),
    ],
  });
  const competing = booked(await submit(h, f.self, competitor));
  expect(competing.status).toBe("confirmed");
  expect(await submit(h, f.base, sentBack)).toEqual(noCapacity);
  expect(
    booked(
      await command(h, f.self, {
        type: "cancelBooking",
        ...target(competing),
        reason: "Waiting for supervisor",
      }),
    ).status,
  ).toBe("cancelled");

  const resubmissionId = randomUUID();
  const resubmitted = booked(await submit(h, f.base, sentBack, resubmissionId));
  expect(resubmitted.status).toBe("pending");
  const approvalId = randomUUID();
  const approved = booked(await review(h, f.manager, resubmitted, "approve", approvalId));
  expect(approved).toMatchObject({ status: "confirmed", version: resubmitted.version + 1 });
  expect(booked(await review(h, f.manager, resubmitted, "approve", approvalId))).toEqual(approved);
  expect(await review(h, f.manager, resubmitted, "approve")).toEqual({ ok: false, error: "stale" });
  expect(
    await h.db
      .select()
      .from(assetBookingReceipts)
      .where(eq(assetBookingReceipts.requestId, approvalId)),
  ).toHaveLength(1);

  const siteId = f.source.siteId;
  expect(await membership(h, f.admin, siteId, f.base.userId, null)).toMatchObject({ ok: true });
  expect(await submit(h, f.base, sentBack, resubmissionId)).toEqual(unavailable);
  const replayedGrant = await membership(h, f.admin, siteId, f.base.userId, "base", f.baseGrant);
  assert(replayedGrant.ok);
  expect(replayedGrant.value.memberships.some(({ userId }) => userId === f.base.userId)).toBe(
    false,
  );
  expect(accepted(await readBookingWorkspace(h.db, f.base, signal())).bookings).toEqual([]);
  const retained = accepted(await readBookingWorkspace(h.db, f.manager, signal()));
  expect(selected(retained.bookings.find(({ id }) => id === approved.id)).status).toBe("confirmed");
}

it("keeps role-scoped pending capacity and protects legacy operations until approval or release", async () => {
  const h = await makeTestDb();
  try {
    const f = await setup(h);
    const { base, self, source } = f;
    const window = slot();
    await deniedScopes(h, f, window);
    const draft = booked(
      await command(h, base, intent(base, source.siteId, window, exactDemand(f))),
    );
    const pending = booked(await submit(h, base, draft));
    expect(pending.status).toBe("pending");
    const model = { kind: "model", resourceId: f.modelId, locationId: null, quantity: 2 } as const;
    const demand = intent(self, source.siteId, window, model, "Two fleet meters");
    const competitor = booked(await command(h, self, demand));
    const preview = { siteId: source.siteId, bookingId: competitor.id, window, lines: [model] };
    expect(await checkBookingAvailability(h.db, self, preview, signal())).toEqual(noCapacity);
    expect(
      await checkBookingAvailability(h.db, self, { ...preview, bookingId: pending.id }, signal()),
    ).toEqual(unavailable);
    expect(await submit(h, self, competitor)).toEqual(noCapacity);
    const own = accepted(await readBookingWorkspace(h.db, self, signal()));
    expect(own.bookings.map(({ id }) => id)).toEqual([competitor.id]);
    expect(own.calendar).toEqual([
      expect.objectContaining({ kind: "pending", bookingId: null, title: null }),
    ]);
    expect(own.calendar[0]?.id).not.toBe(pending.id);
    await legacyGuards(h, f);
    await moderation(h, f, pending, competitor);
  } finally {
    await h.close();
  }
});

async function timedMaintenance(h: TestDb, f: Fixture) {
  const window = slot(24);
  const siteId = f.source.siteId;
  const requested = exactDemand(f);
  const change = {
    type: "saveMaintenance",
    siteId,
    maintenanceId: null,
    version: null,
    title: "Calibration session",
    window,
    demand: requested,
  } satisfies BookingIntent;
  expect(await command(h, f.self, change)).toEqual(unavailable);
  const held = accepted(await command(h, f.manager, change));
  const block = selected(held.maintenance.find(({ title }) => title === change.title));
  const check = { siteId, bookingId: null, window, lines: [requested] };
  expect(await checkBookingAvailability(h.db, f.self, check, signal())).toEqual(noCapacity);
  const next = {
    startAt: window.endAt,
    endAt: new Date(Date.parse(window.endAt) + 3_600_000).toISOString(),
  };
  expect(
    await checkBookingAvailability(h.db, f.self, { ...check, window: next }, signal()),
  ).toEqual({ ok: true });
  expect(
    await command(h, f.manager, {
      type: "cancelMaintenance",
      siteId,
      maintenanceId: block.id,
      version: block.version,
    }),
  ).toMatchObject({ ok: true });
  expect(await checkBookingAvailability(h.db, f.self, check, signal())).toEqual({ ok: true });
}

it("commits only one racing pending or confirmed claim and checks timed maintenance at its boundaries", async () => {
  const h = await makeTestDb();
  try {
    const f = await setup(h);
    const { base, self, source } = f;
    const window = slot();
    const demand = exactDemand(f);
    const first = booked(await command(h, base, intent(base, source.siteId, window, demand)));
    const second = booked(await command(h, self, intent(self, source.siteId, window, demand)));
    const firstId = randomUUID();
    const secondId = randomUUID();
    const results = await Promise.all([
      submit(h, base, first, firstId),
      submit(h, self, second, secondId),
    ]);
    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    expect(results.filter(({ ok }) => !ok)).toEqual([noCapacity]);
    const receipt = await h.db
      .select()
      .from(assetBookingReceipts)
      .where(inArray(assetBookingReceipts.requestId, [firstId, secondId]));
    expect(receipt).toHaveLength(1);
    const winner = booked(selected(results.find(({ ok }) => ok)));
    expect(winner.status).toBe(winner.id === first.id ? "pending" : "confirmed");
    const rows = await h.db
      .select()
      .from(assetBookings)
      .where(inArray(assetBookings.id, [first.id, second.id]));
    expect(rows.find(({ id }) => id !== winner.id)).toMatchObject({ status: "draft", version: 1 });
    await timedMaintenance(h, f);
  } finally {
    await h.close();
  }
});

it("rolls back a partially written native submission and retries the same request", async () => {
  const h = await makeTestDb();
  try {
    const f = await setup(h);
    const { base, source } = f;
    const draft = booked(
      await command(h, base, intent(base, source.siteId, slot(), exactDemand(f))),
    );
    const requestId = randomUUID();
    const prior = await readBookingWorkspace(h.db, base, signal());
    await h.db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE FUNCTION test_reject_booking_event() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.kind = 'submitted' THEN
            IF NOT EXISTS (SELECT 1 FROM public.asset_bookings
              WHERE id = NEW.booking_id AND version = NEW.version AND status = 'pending'
            ) OR NOT EXISTS (SELECT 1 FROM public.asset_booking_lines
              WHERE booking_id = NEW.booking_id
            ) THEN
              RAISE EXCEPTION 'Submission event arrived before native effects';
            END IF;
            RAISE EXCEPTION 'Test rejected booking event insert' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$;
      `);
      await tx.execute(sql`
        CREATE TRIGGER test_reject_booking_event BEFORE INSERT ON asset_booking_events
        FOR EACH ROW EXECUTE FUNCTION test_reject_booking_event()
      `);
    });
    try {
      await expect(submit(h, base, draft, requestId)).rejects.toMatchObject({
        cause: { code: "23514", message: "Test rejected booking event insert" },
      });
    } finally {
      await h.db.transaction(async (tx) => {
        await tx.execute(sql`DROP TRIGGER test_reject_booking_event ON asset_booking_events`);
        await tx.execute(sql`DROP FUNCTION test_reject_booking_event()`);
      });
    }
    expect(await readBookingWorkspace(h.db, base, signal())).toEqual(prior);
    expect(
      await h.db
        .select()
        .from(assetBookingReceipts)
        .where(eq(assetBookingReceipts.requestId, requestId)),
    ).toEqual([]);
    expect(booked(await submit(h, base, draft, requestId))).toMatchObject({
      status: "pending",
      version: 2,
    });
    expect(
      await h.db
        .select()
        .from(assetBookingEvents)
        .where(eq(assetBookingEvents.bookingId, draft.id))
        .orderBy(asc(assetBookingEvents.version)),
    ).toMatchObject([
      { version: 1, kind: "created" },
      { version: 2, kind: "submitted" },
    ]);
  } finally {
    await h.close();
  }
});
