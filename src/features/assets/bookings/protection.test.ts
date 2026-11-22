import { describe, expect, it } from "vitest";
import { applyCustodyCommand } from "../custody/transitions";
import { applyKitCommand } from "../kits/transitions";
import { applyAssetWorkspaceCommand } from "../registerCommands";
import { planBookingCapacity } from "./availability";
import {
  createBookingHandoverDemo,
  fixtureBookingScope,
  fixtureHandoverBookingId,
} from "./fixtures";
import { createHandoverState } from "./handover/fixtureState";
import { handoverCapacity } from "./handover/handoverCapacity";
import { projectHandover } from "./handover/projection";
import { applyHandover } from "./handover/transitions";
import { protectBookingCapacity } from "./protection";
import { projectBookings } from "./transitions";

const actor = { id: "5900afd8-320d-4692-8bad-42d634b2ad59", name: "Booking operator" };

function accepted<T extends { ok: true } | { ok: false; error: string }>(
  result: T,
): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(result.error);
  return result as Extract<T, { ok: true }>;
}

function seed() {
  const {
    state,
    assets,
    clock: now,
  } = createBookingHandoverDemo(actor, true, "2026-11-23T08:00:00.000Z");
  const handovers = createHandoverState(assets);
  const view = accepted(projectHandover(state, handovers, fixtureHandoverBookingId, now)).value;
  const custodian = view.custodians[0];
  if (custodian === undefined) throw new Error("Missing booking recipient");
  return { state, handovers, now, view, custodianId: custodian.id };
}

function select(view: ReturnType<typeof seed>["view"], code: string, quantity = 1) {
  for (const line of view.lines) {
    const option = line.options.find((candidate) => candidate.code === code);
    if (option !== undefined) return { lineKey: line.key, targetId: option.targetId, quantity };
  }
  throw new Error(`Missing pickup option ${code}`);
}

function pickup(context: ReturnType<typeof seed>, items: ReturnType<typeof select>[]) {
  const { state, handovers, now, view, custodianId } = context;
  return accepted(
    applyHandover(
      state,
      handovers,
      {
        type: "pickup",
        bookingId: view.bookingId,
        bookingVersion: view.bookingVersion,
        handoverVersion: view.version,
        requestId: crypto.randomUUID(),
        items,
        custodianId,
        keepPickupOpen: false,
        note: null,
      },
      { now, makeId: () => crypto.randomUUID() },
    ),
  );
}

describe("Ordinary equipment writes with active booking handover", () => {
  it("blocks exact held serial and kit checkout without blocking an unrelated bulk return after overdue", () => {
    const initial = seed();
    const clamp = initial.handovers.assets.records.find(({ code }) => code === "CLAMP-201");
    if (clamp?.tracking !== "individual") throw new Error("Missing ordinary custody asset");
    const ordinaryHold = accepted(
      applyCustodyCommand(
        initial.handovers.assets,
        {
          type: "assign",
          siteId: clamp.siteId,
          assetId: clamp.id,
          version: clamp.version,
          quantity: 1,
          custodianId: initial.custodianId,
          locationId: clamp.locationId,
          condition: "good",
          note: null,
          requestId: crypto.randomUUID(),
        },
        actor.name,
      ),
    );
    const withOrdinary = {
      ...initial,
      handovers: { ...initial.handovers, assets: createHandoverState(ordinaryHold.value).assets },
    };
    const meter = select(initial.view, "METER-102");
    const kit = select(initial.view, "WIRE-KIT");
    const booked = pickup(withOrdinary, [meter, kit]);
    const overdue = new Date(Date.parse(booked.value.dueAt) + 25 * 60_000).toISOString();
    const { assets } = booked.handovers;
    const bookedAsset = assets.records.find(({ id }) => id === meter.targetId);
    const unrelated = assets.records.find(({ id }) => id === clamp.id);
    const kitRecord = assets.kits.records.find(({ id }) => id === kit.targetId);
    const check = assets.kits.checkouts.find(({ kitId }) => kitId === kit.targetId);
    const member = check?.lines[0];
    if (
      bookedAsset === undefined ||
      unrelated === undefined ||
      check === undefined ||
      member === undefined ||
      kitRecord === undefined
    )
      throw new Error("Missing exact custody");

    const guard = protectBookingCapacity(
      booked.state,
      booked.handovers,
      booked.booking.siteId,
      overdue,
    );
    if (guard === undefined) throw new Error("Missing handover protection");
    const kitReturn = accepted(
      applyKitCommand(
        assets,
        {
          type: "returnKit",
          siteId: booked.booking.siteId,
          kitId: kitRecord.id,
          version: kitRecord.version,
          checkoutId: check.id,
          lines: [{ lineId: member.id, returned: member.quantity, consumed: 0 }],
          condition: "good",
          note: null,
          requestId: crypto.randomUUID(),
        },
        actor.name,
      ),
    );
    expect(guard(kitReturn.value)).toBe(false);
    const bulk = accepted(
      applyCustodyCommand(
        assets,
        {
          type: "bulkReturn",
          siteId: booked.booking.siteId,
          requestId: crypto.randomUUID(),
          assets: [
            { assetId: bookedAsset.id, version: bookedAsset.version },
            { assetId: unrelated.id, version: unrelated.version },
          ],
          note: null,
          condition: "good",
          locationId: null,
        },
        actor.name,
        guard,
      ),
    );
    expect(bulk.outcomes).toEqual([
      { assetId: bookedAsset.id, ok: false, error: "held" },
      { assetId: unrelated.id, ok: true },
    ]);
    expect(bulk.value.custody.holdings.map(({ assetId }) => assetId)).toEqual([bookedAsset.id]);

    const released = bulk.value.records.find(({ id }) => id === unrelated.id);
    if (released?.tracking !== "individual") throw new Error("Missing returned asset");
    const ordinaryAfterReturn = {
      ...booked.handovers,
      assets: createHandoverState(bulk.value).assets,
    };
    const afterReturn = protectBookingCapacity(
      booked.state,
      ordinaryAfterReturn,
      booked.booking.siteId,
      overdue,
    );
    const next = applyCustodyCommand(
      bulk.value,
      {
        type: "assign",
        siteId: released.siteId,
        assetId: released.id,
        version: released.version,
        quantity: 1,
        custodianId: initial.custodianId,
        locationId: released.locationId,
        condition: "good",
        note: null,
        requestId: crypto.randomUUID(),
      },
      actor.name,
      afterReturn,
    );
    expect(next.ok).toBe(true);
  });

  it("keeps overdue possession unbookable without exposing someone else's booking", () => {
    const initial = seed();
    const booked = pickup(initial, [select(initial.view, "METER-102")]);
    const overdue = new Date(Date.parse(booked.value.dueAt) + 1).toISOString();
    const next = booked.state.bookings.find(({ title }) => title === "Final meter verification");
    const request = next?.lines[0];
    if (next === undefined || request === undefined) throw new Error("Missing next reservation");

    const capacity = handoverCapacity(booked.state, booked.handovers, overdue);
    const result = planBookingCapacity(
      capacity.inventory,
      capacity.commitments(next.siteId, next.id, [request]),
      {
        asOf: overdue,
        request: { siteId: next.siteId, window: next.window, demands: [request] },
      },
    );
    expect(result).toEqual({ ok: false, error: "conflict" });
    const outside = projectBookings(fixtureBookingScope(booked.state, actor, "self_service"));
    expect(outside.bookings).toEqual([]);
    const stored = outside.calendar.find((entry) => entry.window.startAt === next.window.startAt);
    expect(stored).toMatchObject({ bookingId: null, title: null, kind: "confirmed" });
  });

  it("allows ordinary reductions above the inspection floor and rejects debiting an inspected bin", () => {
    const initial = seed();
    const booked = pickup(initial, [select(initial.view, "LEAD-SET", 4)]);
    const allocation = booked.value.allocations[0];
    if (allocation?.sourceLocationId == null) throw new Error("Missing pool allocation");
    const bin = allocation.sourceLocationId;
    const returned = accepted(
      applyHandover(
        booked.state,
        booked.handovers,
        {
          type: "checkIn",
          bookingId: booked.booking.id,
          bookingVersion: booked.booking.version,
          handoverVersion: booked.value.version,
          requestId: crypto.randomUUID(),
          note: null,
          items: [
            {
              kind: "equipment",
              allocationId: allocation.id,
              locationId: bin,
              condition: "damaged",
              quantity: 4,
            },
          ],
        },
        { now: initial.now, makeId: () => crypto.randomUUID() },
      ),
    );
    const pool = returned.handovers.assets.records.find(({ id }) => id === allocation.targetId);
    if (pool?.tracking !== "returnable_pool") throw new Error("Missing returnable pool");
    const { id: assetId, version } = pool;
    const guard = protectBookingCapacity(
      returned.state,
      returned.handovers,
      booked.booking.siteId,
      initial.now,
    );
    if (guard === undefined) throw new Error("Missing inspection protection");
    function adjust(quantity: number) {
      return accepted(
        applyAssetWorkspaceCommand(
          returned.handovers.assets,
          {
            type: "changePool",
            operation: "adjust",
            assetId,
            version,
            requestId: crypto.randomUUID(),
            quantity,
            locationId: bin,
            toLocationId: null,
            reason: "Stock count",
          },
          actor.name,
        ),
      ).value;
    }
    expect(guard(adjust(3))).toBe(false);
    expect(guard(adjust(4))).toBe(true);
  });
});
