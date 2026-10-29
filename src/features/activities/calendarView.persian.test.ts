import { describe, expect, it } from "vitest";
import { monthTitle, selectWindow, stepAnchorIso, weekTitle } from "./calendarView";

const PERSIAN = { calendar: "persian", locale: "fa" } as const;

describe("Solar Hijri calendar windows", () => {
  it("starts Farvardin 1405 on Nowruz and fetches its whole six-week grid", () => {
    const { days, range } = selectWindow("month", "2026-03-28", PERSIAN);
    expect(days).toHaveLength(42);
    expect(days[0]?.toISOString()).toBe("2026-03-21T00:00:00.000Z");
    expect(days[41]?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(range.from.toISOString()).toBe("2026-03-21T00:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-05-02T00:00:00.000Z");
  });

  it("uses the Saturday week containing a Gregorian anchor without changing storage dates", () => {
    const { days } = selectWindow("week", "2026-03-27", PERSIAN);
    expect(days[0]?.toISOString().slice(0, 10)).toBe("2026-03-21");
    expect(days[6]?.toISOString().slice(0, 10)).toBe("2026-03-27");
    expect(stepAnchorIso("week", "2026-03-27", 1, PERSIAN)).toBe("2026-04-03");
  });

  it("steps Iranian months across Nowruz, including the leap day", () => {
    expect(stepAnchorIso("month", "2025-03-20", 1, PERSIAN)).toBe("2025-04-19");
    expect(stepAnchorIso("month", "2026-03-21", -1, PERSIAN)).toBe("2026-02-20");
  });

  it("navigates a whole Iranian year in either direction and clamps shorter target months", () => {
    let forward = "2026-03-21";
    let backward = "2026-03-21";
    for (let month = 0; month < 12; month++) {
      forward = stepAnchorIso("month", forward, 1, PERSIAN);
      backward = stepAnchorIso("month", backward, -1, PERSIAN);
    }
    expect(forward).toBe("2027-03-21");
    expect(backward).toBe("2025-03-21");
    expect(stepAnchorIso("month", "2025-09-22", 1, PERSIAN)).toBe("2025-10-22");
  });

  it("localizes month and week titles while allowing English with Solar Hijri dates", () => {
    expect(monthTitle("2026-03-21", PERSIAN)).toBe("فروردین ۱۴۰۵");
    expect(weekTitle("2026-03-21", PERSIAN)).toContain("۱۴۰۵");
    expect(monthTitle("2026-03-21", { calendar: "persian", locale: "en" })).toContain("Farvardin");
    expect(monthTitle("2026-03-21", { calendar: "gregory", locale: "de" })).toBe("März 2026");
  });
});
