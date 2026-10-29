import { describe, expect, it } from "vitest";
import { availabilityWindow } from "./composerHelpers";

describe("availabilityWindow", () => {
  it("covers the full same-day window through the end time (not just the start instant)", () => {
    // Same-day 10:00 to 11:00: the busy check must span to 11:00, else a 10:30 conflict reads Free.
    const w = availabilityWindow("2026-07-02", "10:00", "", "11:00");
    expect(w.from).toBe("2026-07-02T10:00:00.000Z");
    expect(w.to).toBe("2026-07-02T11:00:00.000Z");
    expect(w.to).not.toBe(w.from);
  });

  it("uses the end date + end time for a multi-day window", () => {
    const w = availabilityWindow("2026-07-01", "09:00", "2026-07-03", "17:00");
    expect(w.from).toBe("2026-07-01T09:00:00.000Z");
    expect(w.to).toBe("2026-07-03T17:00:00.000Z");
  });

  it("falls back to the start instant when no end time or date is given", () => {
    const w = availabilityWindow("2026-07-02", "10:00", "", "");
    expect(w.to).toBe(w.from);
  });
});

it("checks every instant of an all-day civil date across a DST change", () => {
  expect(availabilityWindow("2026-03-08", "", "", "", "America/New_York")).toEqual({
    from: "2026-03-08T05:00:00.000Z",
    to: "2026-03-09T04:00:00.000Z",
  });
});
