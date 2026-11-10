import { describe, expect, it } from "vitest";
import { parseCalendarParams, selectWindow, stepAnchorIso } from "./calendarView";

it("retains the day view in a durable URL", () => {
  expect(parseCalendarParams({ view: "day", d: "2027-03-21" })).toEqual({
    view: "day",
    anchorIso: "2027-03-21",
  });
});

describe.each([
  ["2026-03-29", 23],
  ["2026-10-25", 25],
] as const)("day view on %s", (date, hours) => {
  it("fetches exactly the civil day across a DST transition", () => {
    const window = selectWindow("day", date, { timeZone: "Europe/Berlin" });
    expect(window.days.map((d) => d.toISOString().slice(0, 10))).toEqual([date]);
    expect((window.range.to.getTime() - window.range.from.getTime()) / 3_600_000).toBe(hours);
  });
});

it("steps one civil day across Nowruz in either display calendar", () => {
  expect(stepAnchorIso("day", "2027-03-20", 1, { calendar: "persian", locale: "fa" })).toBe(
    "2027-03-21",
  );
  expect(stepAnchorIso("day", "2027-03-21", -1)).toBe("2027-03-20");
});
