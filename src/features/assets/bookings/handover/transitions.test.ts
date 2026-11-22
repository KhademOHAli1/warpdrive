import { describe, expect, it } from "vitest";
import { planBookingCapacity } from "../availability";
import type { BookingDemand } from "../contracts";
import {
  createBookingHandoverDemo,
  fixtureBookingScope,
  fixtureHandoverBookingId,
} from "../fixtures";
import type {
  BookingHandoverCommand,
  BookingHandoverIntent,
  BookingHandoverView,
} from "./contracts";
import { createHandoverFixture, type HandoverFixtureState } from "./fixtureState";
import { fixtureHandoverCapacity } from "./handoverCapacity";
import { projectFixtureHandover } from "./projection";
import { applyFixtureHandover } from "./transitions";

const actor = { id: "5900afd8-320d-4692-8bad-42d634b2ad59", name: "Booking operator" };
type Payload = BookingHandoverIntent extends infer Intent
  ? Intent extends { bookingId: string }
    ? Omit<Intent, "bookingId" | "bookingVersion" | "handoverVersion">
    : never
  : never;

function accepted<T extends { ok: true } | { ok: false; error: string }>(
  result: T,
): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(result.error);
  return result as Extract<T, { ok: true }>;
}

function seed() {
  const demo = createBookingHandoverDemo(actor, true, "2026-11-23T08:00:00.000Z");
  const handovers = createHandoverFixture(demo.assets);
  const now = demo.clock;
  return {
    state: demo.state,
    handovers,
    now,
    value: accepted(projectFixtureHandover(demo.state, handovers, fixtureHandoverBookingId, now))
      .value,
  };
}

function command(view: BookingHandoverView, payload: Payload): BookingHandoverCommand {
  return {
    ...payload,
    bookingId: view.bookingId,
    bookingVersion: view.bookingVersion,
    handoverVersion: view.version,
    requestId: crypto.randomUUID(),
  };
}

function run(
  context: Pick<ReturnType<typeof seed>, "state" | "handovers">,
  input: BookingHandoverCommand,
  at: string,
) {
  return applyFixtureHandover(context.state, context.handovers, input, {
    now: at,
    makeId: () => crypto.randomUUID(),
  });
}

function equipment(view: BookingHandoverView, code: string, bin?: string) {
  const line = view.lines.find(
    (row) => row.code === code && (bin === undefined || row.bin?.endsWith(bin) === true),
  );
  if (line === undefined) throw new Error(`Missing equipment booking line: ${code}`);
  return line;
}

function selected(
  view: BookingHandoverView,
  code: string,
  quantity: number,
  bin?: string,
  actualCode?: string,
) {
  const line = equipment(view, code, bin);
  const option = line.options.find((row) => actualCode === undefined || row.code === actualCode);
  if (option === undefined) throw new Error(`Missing pickup option: ${actualCode ?? code}`);
  return { lineKey: line.key, targetId: option.targetId, quantity };
}

function custodian(view: BookingHandoverView) {
  const first = view.custodians[0];
  if (first === undefined) throw new Error("Missing fixture custodian");
  return first.id;
}

function poolAt(handovers: HandoverFixtureState, targetId: string, locationId: string) {
  const pool = handovers.assets.records.find(({ id }) => id === targetId);
  if (pool === undefined || pool.tracking === "individual") throw new Error("Missing fixture pool");
  return pool.balances.find((balance) => balance.locationId === locationId)?.quantity ?? 0;
}

function shiftMinutes(at: string, minutes: number) {
  return new Date(Date.parse(at) + minutes * 60_000).toISOString();
}

describe("Scheduled booking handovers", () => {
  it("picks in stages, debits the exact bins, settles a frozen kit and snapshots receipts", () => {
    const initial = seed();
    const { view, now } = { view: initial.value, now: initial.now };
    const meter = selected(view, "MULTI-87", 1, undefined, "METER-102");
    const leads = selected(view, "LEAD-SET", 4, "Bin A-01");
    const supplies = selected(view, "FERRULE-1", 3);
    const pickup = command(view, {
      type: "pickup",
      custodianId: custodian(view),
      keepPickupOpen: true,
      note: "Front desk pickup",
      items: [meter, leads, supplies],
    });
    const first = accepted(run(initial, pickup, now));
    const meterOut = first.value.allocations.find(({ targetId }) => targetId === meter.targetId);
    const leadsOut = first.value.allocations.find(({ targetId }) => targetId === leads.targetId);
    if (meterOut === undefined || leadsOut?.sourceLocationId == null)
      throw new Error("Missing custody");
    expect(meterOut.code).toBe("METER-102");
    const source = leadsOut.sourceLocationId;
    const otherBins = initial.handovers.assets.records.find(({ id }) => id === leads.targetId);
    if (otherBins?.tracking !== "returnable_pool") throw new Error("Missing leads");
    const [receiving, third] = otherBins.balances.filter(({ locationId }) => locationId !== source);
    if (receiving === undefined || third === undefined) throw new Error("Missing separate bin");
    expect(poolAt(first.handovers, leads.targetId, source)).toBe(
      poolAt(initial.handovers, leads.targetId, source) - 4,
    );
    expect(poolAt(first.handovers, leads.targetId, receiving.locationId)).toBe(receiving.quantity);
    expect(poolAt(first.handovers, leads.targetId, third.locationId)).toBe(third.quantity);
    expect(
      first.value.allocations.find(({ targetId }) => targetId === supplies.targetId)?.outstanding,
    ).toBe(0);
    expect(
      first.value.receipts[0]?.items.find(({ targetId }) => targetId === supplies.targetId)
        ?.disposition,
    ).toBe("consumed");
    expect(first.value.status).toBe("ongoing");
    expect(first.value.pickupClosed).toBe(false);

    const second = accepted(
      run(
        first,
        command(first.value, {
          type: "pickup",
          custodianId: custodian(view),
          keepPickupOpen: true,
          note: null,
          items: [
            selected(first.value, "MULTI-87", 1, undefined, "METER-101"),
            selected(first.value, "LEAD-SET", 2, "Receiving"),
            selected(first.value, "WIRE-KIT", 1),
          ],
        }),
        now,
      ),
    );
    expect(second.value.pickupClosed).toBe(true);
    const kit = second.value.allocations.find(({ kind }) => kind === "kit");
    const member = kit?.members[0];
    if (kit === undefined || member === undefined) throw new Error("Missing frozen member");
    expect(member).toMatchObject({ code: "FERRULE-1", outstanding: 3, consumable: true });
    const partial = accepted(
      run(
        second,
        command(second.value, {
          type: "checkIn",
          note: "Partial check-in",
          items: [
            {
              kind: "equipment",
              allocationId: leadsOut.id,
              locationId: third.locationId,
              quantity: 2,
              condition: "good",
            },
            {
              kind: "kit",
              allocationId: kit.id,
              members: [{ id: member.id, returned: 1, consumed: 0 }],
            },
          ],
        }),
        shiftMinutes(now, 10),
      ),
    );
    expect(poolAt(partial.handovers, leads.targetId, third.locationId)).toBe(third.quantity + 2);
    expect(poolAt(partial.handovers, leads.targetId, source)).toBe(
      poolAt(first.handovers, leads.targetId, source),
    );
    expect(poolAt(partial.handovers, leads.targetId, receiving.locationId)).toBe(
      receiving.quantity - 2,
    );
    expect(partial.value.allocations.find(({ id }) => id === kit.id)?.members[0]?.outstanding).toBe(
      2,
    );
    expect(partial.value.receipts[0]?.remaining).toContainEqual(
      expect.objectContaining({
        targetId: member.targetId,
        code: member.code,
        quantity: 2,
        kitId: kit.targetId,
      }),
    );
    expect(partial.value.receipts[0]).toMatchObject({
      bookingTitle: initial.state.bookings[0]?.title,
      note: "Partial check-in",
    });
    expect(partial.value.receipts[2]).toEqual(first.value.receipts[0]);

    const settled = accepted(
      run(
        partial,
        command(partial.value, {
          type: "checkIn",
          note: null,
          items: [
            {
              kind: "kit",
              allocationId: kit.id,
              members: [{ id: member.id, returned: 1, consumed: 1 }],
            },
          ],
        }),
        shiftMinutes(now, 15),
      ),
    );
    expect(settled.value.allocations.find(({ id }) => id === kit.id)?.outstanding).toBe(0);
    expect(
      settled.handovers.assets.kits?.checkouts.find(({ kitId }) => kitId === kit.targetId)
        ?.closedAt,
    ).not.toBeNull();
    expect(settled.value.receipts[0]?.items.map(({ disposition }) => disposition)).toEqual([
      "returned",
      "consumed",
    ]);
    const kitAvailability = fixtureHandoverCapacity(settled.state, settled.handovers, now);
    expect(kitAvailability.inventory.kits.some(({ id }) => id === kit.targetId)).toBe(false);
  });

  it("rejects stale or mismatched physical selections atomically and binds replay to actor and contents", () => {
    const initial = seed();
    const { value: view, now } = initial;
    const meter = selected(view, "MULTI-87", 1, undefined, "METER-102");
    const leads = selected(view, "LEAD-SET", 4, "Bin A-01");
    const input = command(view, {
      type: "pickup",
      custodianId: custodian(view),
      items: [leads, meter],
      note: null,
      keepPickupOpen: true,
    });
    const scope = (role: "base" | "self_service") => ({
      ...initial,
      state: fixtureBookingScope(initial.state, actor, role),
    });
    expect(
      accepted(projectFixtureHandover(scope("base").state, initial.handovers, view.bookingId, now))
        .value,
    ).toMatchObject({ canOperate: false, custodians: [], locations: [] });
    expect(
      projectFixtureHandover(scope("self_service").state, initial.handovers, view.bookingId, now),
    ).toEqual({ ok: false, error: "unavailable" });
    expect(run(scope("base"), input, now)).toEqual({ ok: false, error: "unavailable" });
    if (input.type !== "pickup") throw new Error("Missing pickup");
    expect(run(initial, { ...input, items: [leads, leads] }, now)).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(
      run(initial, { ...input, items: [leads, { ...meter, targetId: leads.targetId }] }, now),
    ).toEqual({ ok: false, error: "capacity" });
    expect(initial.handovers.assets.custody?.holdings).toEqual([]);
    expect(initial.handovers.sessions).toEqual({});
    const picked = accepted(run(initial, input, now));
    expect(accepted(run(picked, input, now)).handovers).toBe(picked.handovers);
    expect(run(picked, { ...input, note: "changed" }, now)).toEqual({
      ok: false,
      error: "conflict",
    });
    expect(run(picked, { ...input, requestId: crypto.randomUUID() }, now)).toEqual({
      ok: false,
      error: "stale",
    });
    expect(run({ ...picked, state: scope("base").state }, input, now)).toEqual({
      ok: false,
      error: "unavailable",
    });
  });

  it("does not count a checked-in serial twice against the same booking", () => {
    const initial = seed();
    const { value: view, now } = initial;
    const meter = selected(view, "MULTI-87", 1, undefined, "METER-101");
    const first = accepted(
      run(
        initial,
        command(view, {
          type: "pickup",
          custodianId: custodian(view),
          items: [meter],
          note: null,
          keepPickupOpen: true,
        }),
        now,
      ),
    );
    const allocation = first.value.allocations[0];
    if (allocation?.sourceLocationId == null) throw new Error("Missing picked serial");
    const returned = accepted(
      run(
        first,
        command(first.value, {
          type: "checkIn",
          note: null,
          items: [
            {
              kind: "equipment",
              allocationId: allocation.id,
              locationId: allocation.sourceLocationId,
              quantity: 1,
              condition: "good",
            },
          ],
        }),
        now,
      ),
    );
    expect(
      equipment(returned.value, "MULTI-87").options.some(
        ({ targetId }) => targetId === meter.targetId,
      ),
    ).toBe(false);
    expect(
      run(
        returned,
        command(returned.value, {
          type: "pickup",
          custodianId: custodian(view),
          items: [meter],
          note: null,
          keepPickupOpen: true,
        }),
        now,
      ),
    ).toEqual({ ok: false, error: "capacity" });

    const capacity = fixtureHandoverCapacity(returned.state, returned.handovers, now);
    expect(capacity.inventory.assets.some(({ id }) => id === meter.targetId)).toBe(true);
    expect(capacity.commitments(returned.booking.siteId)).toContainEqual(
      expect.objectContaining({
        excludeModelAssetIds: [meter.targetId],
      }),
    );
  });

  it("ends recipient custody for damaged equipment and holds the exact returned bin out of capacity", () => {
    const initial = seed();
    const { value: view, now } = initial;
    const meter = selected(view, "MULTI-87", 1, undefined, "METER-102");
    const leads = selected(view, "LEAD-SET", 4, "Bin A-01");
    const picked = accepted(
      run(
        initial,
        command(view, {
          type: "pickup",
          custodianId: custodian(view),
          items: [meter, leads],
          note: null,
          keepPickupOpen: true,
        }),
        now,
      ),
    );
    const outMeter = picked.value.allocations.find(({ targetId }) => targetId === meter.targetId);
    const outLeads = picked.value.allocations.find(({ targetId }) => targetId === leads.targetId);
    const receiving = picked.value.locations.find(({ name }) => name.includes("Receiving"));
    if (outMeter === undefined || outLeads?.sourceLocationId == null || receiving === undefined) {
      throw new Error("Missing held equipment or receiving bin");
    }
    const moved = accepted(
      run(
        picked,
        command(picked.value, {
          type: "checkIn",
          note: null,
          items: [
            {
              kind: "equipment",
              allocationId: outMeter.id,
              locationId: receiving.id,
              quantity: 1,
              condition: "needs_inspection",
            },
            {
              kind: "equipment",
              allocationId: outLeads.id,
              locationId: receiving.id,
              quantity: 2,
              condition: "damaged",
            },
          ],
        }),
        now,
      ),
    );
    expect(
      moved.handovers.assets.custody?.holdings.some(({ assetId }) => assetId === meter.targetId),
    ).toBe(false);
    expect(moved.handovers.assets.records.find(({ id }) => id === meter.targetId)).toMatchObject({
      locationId: receiving.id,
    });
    const priorFree = poolAt(picked.handovers, leads.targetId, receiving.id);
    expect(poolAt(moved.handovers, leads.targetId, receiving.id)).toBe(priorFree + 2);
    expect(moved.handovers.inspection).toEqual([
      expect.objectContaining({
        targetId: meter.targetId,
        locationId: receiving.id,
        condition: "needs_inspection",
        quantity: 1,
      }),
      expect.objectContaining({
        targetId: leads.targetId,
        locationId: receiving.id,
        condition: "damaged",
        quantity: 2,
      }),
    ]);
    expect(moved.value.receipts[0]?.items).toEqual([
      expect.objectContaining({
        targetId: meter.targetId,
        destinationBin: receiving.name,
        disposition: "needs_inspection",
      }),
      expect.objectContaining({
        targetId: leads.targetId,
        destinationBin: receiving.name,
        disposition: "damaged",
      }),
    ]);
    const capacity = fixtureHandoverCapacity(moved.state, moved.handovers, now);
    expect(capacity.inventory.assets.some(({ id }) => id === meter.targetId)).toBe(false);
    expect(
      capacity.inventory.pools.find(
        ({ id, locationId }) => id === leads.targetId && locationId === receiving.id,
      )?.quantity,
    ).toBe(priorFree);
    const outSource = outLeads.sourceLocationId;
    expect(
      capacity.inventory.pools.find(
        ({ id, locationId }) => id === leads.targetId && locationId === outSource,
      )?.quantity,
    ).toBe(poolAt(picked.handovers, leads.targetId, outSource) + 2);
  });

  it("protects later bookings when extending a picked unit and distinguishes expiration from overdue custody", () => {
    const initial = seed();
    const { value: view, now } = initial;
    const meter = selected(view, "MULTI-87", 1, undefined, "METER-102");
    const picked = accepted(
      run(
        initial,
        command(view, {
          type: "pickup",
          custodianId: custodian(view),
          items: [meter],
          note: null,
          keepPickupOpen: false,
        }),
        now,
      ),
    );
    const obsolete = command(picked.value, {
      type: "amendDue",
      dueAt: shiftMinutes(view.dueAt, 30),
      reason: "Need more time",
    });
    expect(run(picked, obsolete, now)).toEqual({ ok: false, error: "capacity" });
    expect(picked.booking.window.endAt).toBe(view.dueAt);

    const approved = accepted(
      run(
        picked,
        command(picked.value, {
          type: "amendDue",
          dueAt: shiftMinutes(view.dueAt, 10),
          reason: "Confirmed with equipment desk",
        }),
        now,
      ),
    );
    expect(approved.booking.window.endAt).toBe(shiftMinutes(view.dueAt, 10));
    expect(approved.booking.version).toBe(view.bookingVersion + 1);
    expect(approved.value.receipts[0]).toMatchObject({
      previousDueAt: view.dueAt,
      dueAt: approved.value.dueAt,
    });
    expect(approved.value.receipts[1]).toEqual(picked.value.receipts[0]);

    const future = shiftMinutes(view.dueAt, 12);
    const missed = approved.state.bookings.find(({ title }) => title === "Uncollected clamp meter");
    if (missed === undefined) throw new Error("Missing expired fixture");
    expect(
      accepted(projectFixtureHandover(approved.state, approved.handovers, missed.id, future)).value,
    ).toMatchObject({ status: "expired", pickupClosed: true, notices: [{ kind: "expired" }] });
    expect(
      accepted(projectFixtureHandover(approved.state, approved.handovers, view.bookingId, future))
        .value,
    ).toMatchObject({ status: "overdue", pickupClosed: true, notices: [{ kind: "overdue" }] });
    const capacity = fixtureHandoverCapacity(approved.state, approved.handovers, future);
    expect(capacity.inventory.assets.some(({ id }) => id === meter.targetId)).toBe(false);
    const unrelated: BookingDemand =
      missed.lines[0] ??
      (() => {
        throw new Error("Missing clamp meter");
      })();
    expect(
      planBookingCapacity(
        capacity.inventory,
        capacity.commitments(approved.booking.siteId, undefined, [unrelated]),
        {
          asOf: future,
          request: {
            siteId: approved.booking.siteId,
            demands: [unrelated],
            window: { startAt: future, endAt: shiftMinutes(future, 30) },
          },
        },
      ).ok,
    ).toBe(true);
  });
});
