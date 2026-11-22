import { describe, expect, it } from "vitest";
import {
  type BookingCapacityCommitment,
  type BookingCapacityInventory,
  type BookingCapacityRequest,
  planBookingCapacity,
} from "./availability";
import type { BookingDemand } from "./contracts";

const siteId = "works";
const remoteSite = "field";
const main = "tool-crib";
const secondary = "receiving";
const modelId = "meter-model";
const a = { id: "a", siteId, modelId, locationId: main };
const b = { id: "b", siteId, modelId, locationId: secondary };
const c = { id: "c", siteId, modelId, locationId: secondary };
const remote = { id: "remote", siteId: remoteSite, modelId, locationId: main };
const kit = { id: "kit-a", siteId, locationId: main, definitionVersion: 3 };
const pool = {
  id: "lead-kit-pool",
  siteId,
  locationId: main,
  kind: "returnable_pool",
  quantity: 5,
} as const;
const supply = {
  id: "ferrules",
  siteId,
  locationId: main,
  kind: "consumable_pool",
  quantity: 5,
} as const;
const inventory = {
  assets: [a, b, c, remote],
  kits: [kit],
  pools: [pool, { ...pool, locationId: secondary, quantity: 50 }, supply],
} satisfies BookingCapacityInventory;

function time(hour: number) {
  return `2026-12-01T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

function demand(
  kind: BookingDemand["kind"],
  resourceId: string,
  quantity = 1,
  locationId: string | null = null,
): BookingDemand {
  return { kind, resourceId, locationId, quantity };
}

function request(start: number, end: number, demands: BookingDemand[]): BookingCapacityRequest {
  return { siteId, window: { startAt: time(start), endAt: time(end) }, demands };
}

function reservation(
  start: number,
  end: number,
  demands: BookingDemand[],
  state: BookingCapacityCommitment["state"] = "held",
): BookingCapacityCommitment {
  return { ...request(start, end, demands), state };
}

function plan(
  commitments: BookingCapacityCommitment[],
  candidate?: BookingCapacityRequest,
  available: BookingCapacityInventory = inventory,
  asOf = time(7),
) {
  return planBookingCapacity(available, commitments, {
    asOf,
    ...(candidate === undefined ? {} : { request: candidate }),
  });
}

const unavailable = { ok: false, error: "conflict" } as const;

describe("booking capacity", () => {
  it("blocks pending capacity and ignores elapsed and unrelated site claims", () => {
    const exact = demand("asset", a.id);
    const existing = [
      reservation(8, 9, [exact]),
      reservation(9, 11, [exact], "pending"),
      reservation(5, 6, [demand("asset", "removed")], "pending"),
    ];
    const otherSite = {
      ...reservation(11, 12, [demand("asset", "remote-removed")]),
      siteId: remoteSite,
    };
    expect(plan([...existing, otherSite], request(11, 12, [exact]))).toEqual({
      ok: true,
      witness: [{ kind: "asset", resourceId: a.id, assetIds: [a.id] }],
    });
    expect(plan(existing, request(9, 11, [exact]))).toEqual(unavailable);
    expect(plan(existing, request(9, 11, [demand("model", modelId, 1, main)]))).toEqual(
      unavailable,
    );
    expect(plan(existing, request(8, 10, [exact]))).toEqual(unavailable);
    expect(plan(existing, request(9, 11, [demand("asset", remote.id)]))).toEqual(unavailable);
    expect(plan(existing)).toEqual({ ok: true, witness: [] });
  });

  it("rejects a fleet request when no eligible serial stays free across the entire window", () => {
    const eligible = { ...inventory, assets: [a, b, { ...c, locationId: "another-bin" }, remote] };
    const claims = [
      reservation(8, 9, [demand("asset", a.id)]),
      reservation(9, 10, [demand("asset", b.id)], "maintenance"),
      reservation(8, 10, [demand("asset", c.id)]),
    ];
    const wanted = demand("model", modelId);
    expect(plan(claims, request(8, 10, [wanted]), eligible)).toEqual(unavailable);
    expect(plan(claims, request(9, 10, [wanted]), eligible)).toEqual({
      ok: true,
      witness: [{ kind: "model", resourceId: modelId, assetIds: [a.id] }],
    });
    expect(plan(claims, request(9, 10, [{ ...wanted, locationId: secondary }]), eligible)).toEqual(
      unavailable,
    );
  });

  it("backtracks overlapping model assignments around exact blocks and emits only the requested pick", () => {
    const model = demand("model", modelId);
    const privateClaim = {
      ...reservation(9, 11, [model]),
      bookingId: "private-reservation-id",
      actor: "Private actor",
    };
    const existing = [
      reservation(8, 9, [demand("asset", c.id)]),
      reservation(10, 11, [demand("asset", b.id)]),
      privateClaim,
      reservation(9, 11, [model]),
    ];
    // A is tried first for 08:00–10:00, but would leave both other claims only C.
    // B covers the early interval and leaves A and C for the other claims.
    expect(plan(existing, request(8, 10, [model]))).toEqual({
      ok: true,
      witness: [{ kind: "model", resourceId: modelId, assetIds: [b.id] }],
    });
    expect(plan(existing, request(8, 10, [{ ...model, quantity: 2 }]))).toEqual(unavailable);
    expect(plan(existing)).toEqual({ ok: true, witness: [] });
    expect(plan(existing, undefined, { ...inventory, assets: [a, b] })).toEqual(unavailable);
  });

  it("moves a tentative model allocation to preserve an unrelated exact handover", () => {
    const wanted = request(9, 10, [demand("model", modelId, 1)]);
    expect(plan([], wanted)).toMatchObject({ witness: [{ assetIds: [a.id] }] });
    expect(plan([], request(9, 10, [demand("model", modelId, 2)]))).toEqual({
      ok: true,
      witness: [{ kind: "model", resourceId: modelId, assetIds: [a.id, b.id] }],
    });
    const held = [{ ...wanted, state: "held" as const }];
    const withoutA = { ...inventory, assets: [b, c] };
    expect(plan(held, undefined, withoutA)).toEqual({ ok: true, witness: [] });
    expect(plan(held, request(9, 10, [demand("asset", b.id)]), withoutA)).toEqual({
      ok: true,
      witness: [{ kind: "asset", resourceId: b.id, assetIds: [b.id] }],
    });
    expect(plan(held, undefined, { ...inventory, assets: [remote] })).toEqual(unavailable);
  });

  it("uses exact physical pool bins, reuses returned capacity, and never promises consumables twice", () => {
    const returnable = demand(pool.kind, pool.id, 4, main);
    const consumable = demand(supply.kind, supply.id, 4, main);
    const existing = [
      reservation(8, 10, [returnable, consumable]),
      reservation(10, 11, [demand(pool.kind, pool.id, 1, main)], "maintenance"),
    ];
    expect(plan(existing, request(10, 11, [returnable]))).toEqual({
      ok: true,
      witness: [
        {
          kind: "returnable_pool",
          resourceId: pool.id,
          locations: [{ locationId: main, quantity: 4 }],
        },
      ],
    });
    expect(plan(existing, request(9, 11, [returnable]))).toEqual(unavailable);
    expect(plan(existing, request(10, 11, [demand(pool.kind, pool.id, 5, main)]))).toEqual(
      unavailable,
    );
    expect(plan(existing, request(11, 12, [demand(pool.kind, pool.id, 5, main)]))).toMatchObject({
      ok: true,
    });
    expect(plan(existing, request(10, 11, [demand(pool.kind, pool.id, 6, main)]))).toEqual(
      unavailable,
    );
    expect(plan(existing, request(12, 13, [consumable]))).toEqual(unavailable);
    expect(plan(existing, request(12, 13, [consumable]), inventory, time(11))).toMatchObject({
      ok: true,
    });
    expect(plan(existing, request(9, 12, [demand(pool.kind, pool.id, 4)]))).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("checks peak consumable maintenance separately from all promised consumption", () => {
    const consumed = demand(supply.kind, supply.id, 2, main);
    const maintained = demand(supply.kind, supply.id, 3, main);
    const held = [
      reservation(8, 9, [maintained], "maintenance"),
      reservation(11, 12, [consumed], "pending"),
    ];
    const adjacent = { ...request(9, 10, [maintained]), state: "maintenance" as const };
    expect(plan(held, adjacent)).toEqual({
      ok: true,
      witness: [
        {
          kind: supply.kind,
          resourceId: supply.id,
          locations: [{ locationId: main, quantity: 3 }],
        },
      ],
    });
    expect(plan(held, { ...request(8, 10, [maintained]), state: "maintenance" })).toEqual(
      unavailable,
    );
    expect(plan(held, request(9, 10, [maintained]))).toEqual(unavailable);
    expect(plan([...held, reservation(9, 10, [maintained], "maintenance")])).toEqual({
      ok: true,
      witness: [],
    });
  });

  it("requires the named ready kit and checks its pinned definition without exposing packed members", () => {
    const packedMember = "currently-in-the-kit";
    const d = demand("kit", kit.id);
    const availableOnly = { ...inventory, assets: [a] };
    expect(plan([], request(9, 10, [d, demand("model", modelId)]), availableOnly)).toEqual({
      ok: true,
      witness: [
        { kind: "kit", resourceId: kit.id, definitionVersion: kit.definitionVersion },
        { kind: "model", resourceId: modelId, assetIds: [a.id] },
      ],
    });
    expect(plan([], request(9, 10, [d, demand("asset", packedMember)]), availableOnly)).toEqual(
      unavailable,
    );
    const held = [{ ...reservation(9, 10, [d]), kitVersions: { [kit.id]: 3 } }];
    expect(plan(held, request(9, 10, [d]), availableOnly)).toEqual(unavailable);
    expect(plan(held, request(10, 11, [d]), availableOnly)).toMatchObject({ ok: true });
    expect(
      plan(held, undefined, { ...availableOnly, kits: [{ ...kit, definitionVersion: 4 }] }),
    ).toEqual(unavailable);
    expect(plan(held, undefined, { ...availableOnly, kits: [] })).toEqual(unavailable);
    expect(
      plan(held, request(10, 11, [demand("kit", kit.id, 1, secondary)]), availableOnly),
    ).toEqual(unavailable);
  });
});
