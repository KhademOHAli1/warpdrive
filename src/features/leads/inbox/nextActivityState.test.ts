import { describe, expect, it } from "vitest";
import { nextActivityState } from "./nextActivityState";

const now = new Date("2026-07-03T12:00:00");

describe("nextActivityState", () => {
  it("returns 'none' when there is no next activity", () => {
    expect(nextActivityState(null, now)).toBe("none");
  });

  it("returns 'overdue' for a time before the start of today", () => {
    expect(nextActivityState(new Date("2026-07-02T23:59:00"), now)).toBe("overdue");
  });

  it("returns 'today' for a time later today", () => {
    expect(nextActivityState(new Date("2026-07-03T18:00:00"), now)).toBe("today");
  });

  it("returns 'today' at the very start of today even if now is later", () => {
    expect(nextActivityState(new Date("2026-07-03T00:00:00"), now)).toBe("today");
  });

  it("returns 'upcoming' for a future day", () => {
    expect(nextActivityState(new Date("2026-07-05T09:00:00"), now)).toBe("upcoming");
  });

  it("accepts an ISO string", () => {
    expect(nextActivityState("2026-07-10T09:00:00", now)).toBe("upcoming");
  });
});

it("uses the selected time zone rather than the browser day", () => {
  const instant = new Date("2026-03-21T00:00:00Z");
  const due = new Date("2026-03-20T22:00:00Z");
  expect(nextActivityState(due, instant, "Asia/Tehran")).toBe("today");
  expect(nextActivityState(due, instant, "UTC")).toBe("overdue");
});
it("handles a daylight saving date boundary without assuming 24 hour days", () => {
  expect(
    nextActivityState("2026-03-29T22:30:00Z", new Date("2026-03-29T00:00:00Z"), "Europe/Berlin"),
  ).toBe("upcoming");
});
