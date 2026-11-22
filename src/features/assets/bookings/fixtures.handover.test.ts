import { expect, it } from "vitest";
import { assetsFixture } from "../fixtures";
import { createBookingHandoverDemo, fixtureHandoverBookingId } from "./fixtures";
import { lookupFixtureEquipment } from "./handover/fixtureLookup";

const actor = { id: "136af1ef-b34f-4467-97e7-0413e7a45a3a", name: "Demo manager" };
const now = "2026-11-22T02:00:00.000Z";

it("seeds an active loan, an adjacent promise, and a separate uncollected booking", () => {
  const { state, clock, assets } = createBookingHandoverDemo(actor, true, now);
  const active = state.bookings.find(({ id }) => id === fixtureHandoverBookingId);
  expect(active).toMatchObject({
    status: "confirmed",
    window: { startAt: "2026-11-23T08:00:00.000Z", endAt: "2026-11-23T10:00:00.000Z" },
  });
  expect(clock).toBe("2026-11-23T08:15:00.000Z");
  expect(active?.lines.map(({ code, quantity }) => [code, quantity])).toEqual([
    ["MULTI-87", 2],
    ["LEAD-SET", 4],
    ["LEAD-SET", 2],
    ["WIRE-KIT", 1],
    ["FERRULE-1", 3],
  ]);
  const adjacent = state.bookings.find(({ title }) => title === "Final meter verification");
  expect(adjacent?.window.startAt).toBe("2026-11-23T10:15:00.000Z");
  const missed = state.bookings.find(({ title }) => title === "Uncollected clamp meter");
  expect(missed?.lines.map(({ code }) => code)).toEqual(["CLAMP-201"]);

  const pool = (workspace: typeof assets) =>
    workspace.records.find(({ code }) => code === "LEAD-SET");
  expect(pool(assets)).toMatchObject({
    balances: [{ quantity: 12 }, { quantity: 8 }, { quantity: 3 }],
  });
  expect(pool(assetsFixture(true))).toMatchObject({
    balances: [{ quantity: 12 }, { quantity: 8 }],
  });
});

it("resolves manual equipment and kit codes only in the booking site", () => {
  const { state, assets } = createBookingHandoverDemo(actor, true, now);
  const site = state.sites.find(({ code }) => code === "WORKS");
  if (site === undefined) throw new Error("Missing demo site");
  const lookup = (code: string) =>
    lookupFixtureEquipment(assets, site.id, actor.id, "https://warpdrive.test", code);
  expect(lookup(" m87-qa-0101 ")).toEqual({
    ok: true,
    id: "1f07c542-849d-42d9-85c0-56b3ced383fd",
    kind: "asset",
  });
  expect(lookup("wire-kit")).toEqual({
    ok: true,
    id: "0ec2d593-a42c-47e5-9829-3b0290931417",
    kind: "kit",
  });
  expect(lookup("LOOP-01")).toEqual({ ok: false, error: "unavailable" });
});
