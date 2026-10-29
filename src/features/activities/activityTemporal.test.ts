import { describe, expect, it } from "vitest";
import {
  activityDay,
  activityParts,
  civilDateRange,
  instantCivilDate,
  wallTimeToInstant,
} from "./activityTemporal";

describe("explicit-zone activity time", () => {
  it("projects one instant into the account day, independent of runtime zone", () => {
    expect(instantCivilDate("2026-03-20T21:00:00Z", "Asia/Tehran")).toBe("2026-03-21");
    expect(instantCivilDate("2026-03-20T21:00:00Z", "UTC")).toBe("2026-03-20");
    expect(wallTimeToInstant("2026-03-21", "09:00", "Asia/Tehran").iso).toBe(
      "2026-03-21T05:30:00.000Z",
    );
  });
  it("rejects a nonexistent wall time and chooses the earlier occurrence of a new fold", () => {
    expect(() => wallTimeToInstant("2026-03-29", "02:30", "Europe/Berlin")).toThrow(/nonexistent/);
    expect(wallTimeToInstant("2026-10-25", "02:30", "Europe/Berlin")).toEqual({
      iso: "2026-10-25T00:30:00.000Z",
      offset: "+02:00",
      ambiguous: true,
    });
  });
  it("builds actual midnight bounds across a23hour day", () => {
    const r = civilDateRange("2026-03-08", "2026-03-09", "America/New_York");
    expect(r.from.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
  it("keeps canonical all-day dates fixed while explicitly decoding legacy timestamps", () => {
    const a = { dueAt: "2026-03-20T20:30:00Z", allDay: true, dueDate: "2026-03-21" };
    for (const zone of ["Etc/GMT+12", "Pacific/Kiritimati"])
      expect(activityDay(a, zone)).toBe("2026-03-21");
    expect(activityParts({ ...a, dueDate: null }, "Asia/Tehran")).toMatchObject({
      date: "2026-03-21",
      time: "",
      legacy: true,
    });
    expect(activityParts({ ...a, allDay: false, dueDate: null }, "Asia/Tehran")).toMatchObject({
      date: "2026-03-21",
      time: "00:00",
      legacy: false,
    });
  });
});
