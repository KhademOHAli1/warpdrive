import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { users } from "@/db/schema/identity";
import type { BookingDemand, BookingIntent } from "@/features/assets/bookings/contracts";
import type { BookingMembershipRole } from "@/features/assets/bookings/membershipContracts";
import { runBookingMembershipCommand } from "@/features/assets/bookings/membershipService";
import { readBookingWorkspace, runBookingCommand } from "@/features/assets/bookings/service";
import { runAssetCommand } from "@/features/assets/service";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { setRole } from "@/features/inventory/sourcing/sourcing.test-helpers";
import { actor, signal } from "@/features/inventory/warehouse/operations/structures.test-helpers";
import type { LocationsIntent } from "@/features/locations/contracts";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { executeLocationsCommand } from "@/features/locations/service";
import { makeTestDb, type TestDb } from "@/test/db";
import { operationsSearchResultsPerKind } from "./operationsContracts";
import { searchOperations } from "./operationsQuery";

async function site(h: TestDb, code: string) {
  const id = randomUUID();
  await h.db.insert(directorySites).values({ id, code, name: `${code} facility` });
  return id;
}

async function location(h: TestDb, siteId: string, code: string, name: string) {
  const id = randomUUID();
  await h.db.insert(directoryLocations).values({ id, siteId, code, name });
  return id;
}

async function directoryChange(h: TestDb, admin: NativeSessionRef, intent: LocationsIntent) {
  const result = await executeLocationsCommand(
    h.db,
    admin,
    { ...intent, requestId: randomUUID() },
    signal(),
  );
  assert(result.ok, JSON.stringify(result));
}

function directoryViewer(
  h: TestDb,
  admin: NativeSessionRef,
  siteId: string,
  who: NativeSessionRef,
  role: "viewer" | null,
) {
  return directoryChange(h, admin, { type: "setGrant", siteId, userId: who.userId, role });
}

async function membership(
  h: TestDb,
  admin: NativeSessionRef,
  siteId: string,
  who: NativeSessionRef,
  role: BookingMembershipRole | null,
) {
  const result = await runBookingMembershipCommand(
    h.db,
    admin,
    { siteId, userId: who.userId, role, requestId: randomUUID() },
    signal(),
  );
  assert(result.ok, JSON.stringify(result));
}

async function bookingCommand(h: TestDb, who: NativeSessionRef, intent: BookingIntent) {
  const result = await runBookingCommand(
    h.db,
    who,
    { ...intent, requestId: randomUUID() },
    signal(),
  );
  assert(result.ok && result.bookingId !== null, JSON.stringify(result));
  const booking = result.value.bookings.find(({ id }) => id === result.bookingId);
  assert(booking !== undefined);
  return booking;
}

function draft(
  h: TestDb,
  who: NativeSessionRef,
  siteId: string,
  title: string,
  lines: BookingDemand[] = [],
) {
  const start = Date.now() + 72 * 3_600_000;
  return bookingCommand(h, who, {
    type: "saveBooking",
    siteId,
    bookingId: null,
    version: null,
    requesterId: who.userId,
    title,
    description: null,
    window: {
      startAt: new Date(start).toISOString(),
      endAt: new Date(start + 3_600_000).toISOString(),
    },
    lines,
  });
}

async function assetDemand(
  h: TestDb,
  admin: NativeSessionRef,
  siteId: string,
  locationId: string,
): Promise<BookingDemand> {
  const result = await runAssetCommand(
    h.db,
    admin,
    {
      type: "create",
      siteId,
      locationId,
      name: "Bench meter unit",
      code: "BENCH-METER-1",
      serial: "BENCH-METER-1",
      tracking: "individual",
      modelId: null,
      description: null,
      categoryId: null,
      tags: [],
      openingQuantity: 0,
      fieldValues: {},
      requestId: randomUUID(),
    },
    signal(),
  );
  assert(result.ok && result.focusId !== null, JSON.stringify(result));
  return { kind: "asset", resourceId: result.focusId, locationId, quantity: 1 };
}

async function actorsAndBookmarks(h: TestDb) {
  const admin = await actor(h, "Operations administrator", true);
  const directoryOnly = await actor(h, "Directory-only viewer");
  const base = await actor(h, "Base member");
  const self = await actor(h, "Self-service member");
  const manager = await actor(h, "West equipment manager");
  const occupancyViewer = await actor(h, "Calendar-only equipment viewer");
  const warehouse = await actor(h, "Warehouse-only staff");
  const guest = await actor(h, "Projects-only guest");
  const west = await site(h, "WEST");
  const east = await site(h, "EAST");
  const westBench = await location(h, west, "WEST-BENCH", "Bench calibration room west");
  const eastBench = await location(h, east, "EAST-BENCH", "Bench calibration room east");

  await directoryViewer(h, admin, west, directoryOnly, "viewer");
  await membership(h, admin, west, base, "base");
  await membership(h, admin, west, self, "self_service");
  await setRole(h, admin, manager, west, "asset_manager");
  await setRole(h, admin, occupancyViewer, west, "asset_viewer");
  await setRole(h, admin, warehouse, west, "warehouse_manager");
  await directoryViewer(h, admin, west, guest, "viewer");
  await membership(h, admin, west, guest, "self_service");

  const demand = await assetDemand(h, admin, west, westBench);
  const initial = await draft(h, base, west, "Bench calibration for Base engineering", [demand]);
  const baseBooking = await bookingCommand(h, base, {
    type: "submitBooking",
    siteId: west,
    bookingId: initial.id,
    version: initial.version,
  });
  assert(baseBooking.status === "confirmed");
  const selfBooking = await draft(h, self, west, "Bench calibration for Self-service QA");
  const eastBooking = await draft(h, admin, east, "Bench calibration for eastern service");
  const guestBooking = await draft(h, guest, west, "Guest training booking");
  await h.db.update(users).set({ projectsGuestOnly: true }).where(eq(users.id, guest.userId));
  return {
    admin,
    directoryOnly,
    base,
    self,
    manager,
    occupancyViewer,
    warehouse,
    guest,
    west,
    westBench,
    eastBench,
    baseBooking,
    selfBooking,
    eastBooking,
    guestBooking,
  };
}

it("searches independent Directory and Booking scopes and rechecks current membership", async () => {
  const h = await makeTestDb();
  try {
    const f = await actorsAndBookmarks(h);
    const term = "calibration BENCH";
    const read = (who: NativeSessionRef, q = term) => searchOperations(h.db, who, q, signal());
    const known = async (who: NativeSessionRef, ids: string[]) => {
      const results = await read(who);
      expect(results.map(({ id }) => id).sort()).toEqual([...ids].sort());
      return results;
    };

    expect(await known(f.directoryOnly, [f.westBench])).toMatchObject([{ kind: "location" }]);
    expect(await known(f.base, [f.baseBooking.id])).toMatchObject([
      { kind: "booking", primary: f.baseBooking.title },
    ]);
    expect(await known(f.self, [f.selfBooking.id])).toMatchObject([
      { kind: "booking", primary: f.selfBooking.title },
    ]);
    const authorized = await known(f.manager, [f.westBench, f.baseBooking.id, f.selfBooking.id]);
    const confirmed = authorized.find(({ id }) => id === f.baseBooking.id);
    assert(confirmed !== undefined);
    expect(Object.keys(confirmed).sort()).toEqual(["id", "kind", "primary", "secondary"]);
    await known(f.admin, [
      f.westBench,
      f.eastBench,
      f.baseBooking.id,
      f.selfBooking.id,
      f.eastBooking.id,
    ]);

    const occupancy = await readBookingWorkspace(h.db, f.occupancyViewer, signal());
    assert(occupancy.ok);
    expect(occupancy.value.bookings).toEqual([]);
    expect(occupancy.value.calendar).toContainEqual(
      expect.objectContaining({
        kind: "confirmed",
        bookingId: null,
        title: null,
        window: f.baseBooking.window,
      }),
    );
    await known(f.occupancyViewer, [f.westBench]);
    expect(await read(f.occupancyViewer, f.baseBooking.title)).toEqual([]);
    expect(await read(f.self, f.baseBooking.id)).toEqual([]);
    expect(await read(f.base, f.selfBooking.title)).toEqual([]);
    await known(f.warehouse, []);
    await known(f.guest, []);
    expect(await read(f.guest, f.guestBooking.title)).toEqual([]);

    await directoryViewer(h, f.admin, f.west, f.directoryOnly, null);
    await membership(h, f.admin, f.west, f.base, null);
    await setRole(h, f.admin, f.occupancyViewer, f.west, "asset_viewer", false);
    await setRole(h, f.admin, f.manager, f.west, "asset_manager", false);
    for (const who of [f.directoryOnly, f.base, f.occupancyViewer, f.manager]) await known(who, []);
    await known(f.self, [f.selfBooking.id]);
  } finally {
    await h.close();
  }
});

it("prefers exact literal matches, caps each result group and excludes archived rows and sites", async () => {
  const h = await makeTestDb();
  try {
    const admin = await actor(h, "Archive and ranking administrator", true);
    const live = await site(h, "LIVE");
    const retired = await site(h, "RETIRED");
    const literalLocation = await location(h, live, "GAUGE-1", "Gauge %_ marker");
    await location(h, live, "GAUGE-2", "Gauge unrelated marker");
    const literalBooking = await draft(h, admin, live, "Gauge %_ marker");
    await draft(h, admin, live, "Gauge unrelated marker");
    const archivedLocation = await location(h, live, "OLD-GAUGE", "Gauge %_ retired shelf");
    const archivedBooking = await draft(h, admin, live, "Gauge %_ retired booking");
    await directoryChange(h, admin, {
      type: "setLocationArchived",
      id: archivedLocation,
      archived: true,
    });
    await bookingCommand(h, admin, {
      type: "archiveBooking",
      siteId: live,
      bookingId: archivedBooking.id,
      version: archivedBooking.version,
      archived: true,
    });
    await draft(h, admin, retired, "Gauge %_ retired site booking");
    await directoryChange(h, admin, { type: "setSiteArchived", id: retired, archived: true });

    const read = (query: string) => searchOperations(h.db, admin, query, signal());
    const literal = await read("gauge %_");
    expect(literal.map(({ id }) => id).sort()).toEqual([literalLocation, literalBooking.id].sort());

    const exactLocation = await location(h, live, "CALIBRATE", "Calibration");
    const exactBooking = await draft(h, admin, live, "Calibration");
    for (let count = 0; count < operationsSearchResultsPerKind + 2; count++) {
      await location(h, live, `ROUND-${count}`, `Calibration bench ${count}`);
      await draft(h, admin, live, `Calibration window ${count}`);
    }
    const ranked = await read("calibration");
    const locations = ranked.filter(({ kind }) => kind === "location");
    const bookings = ranked.filter(({ kind }) => kind === "booking");
    expect(locations).toHaveLength(operationsSearchResultsPerKind);
    expect(bookings).toHaveLength(operationsSearchResultsPerKind);
    expect(locations[0]?.id).toBe(exactLocation);
    expect(bookings[0]?.id).toBe(exactBooking.id);
    expect(await read("calibration")).toEqual(ranked);
    expect(await read("  ")).toEqual([]);
  } finally {
    await h.close();
  }
});
