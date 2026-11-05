import { expect, it } from "vitest";
import {
  calendarHref,
  dayTitle,
  monthTitle,
  parseCalendarParams,
  selectWindow,
  stepAnchorIso,
  weekTitle,
  yearTitle,
} from "./calendarView";

it("weekTitle carries the month and year so navigation stays oriented", () => {
  expect(weekTitle("2026-06-15")).toBe("Jun 15, 2026");
  expect(weekTitle("2027-01-04")).toBe("Jan 4, 2027");
});

const TODAY = new Date("2026-07-03T12:00:00Z");

it("defaults to week + today when params are absent", () => {
  expect(parseCalendarParams({}, TODAY)).toEqual({ view: "week", anchorIso: "2026-07-03" });
});

it("accepts valid view and anchor", () => {
  expect(parseCalendarParams({ view: "month", d: "2026-06-15" }, TODAY)).toEqual({
    view: "month",
    anchorIso: "2026-06-15",
  });
});

it.each(["day", "week", "month", "year"] as const)(
  "round-trips the %s view through its URL",
  (view) => {
    const url = new URL(calendarHref(view, "2026-11-05"), "https://warpdrive.test");
    expect(
      parseCalendarParams(
        {
          view: url.searchParams.get("view") ?? undefined,
          d: url.searchParams.get("d") ?? undefined,
        },
        TODAY,
      ),
    ).toEqual({ view, anchorIso: "2026-11-05" });
  },
);

it("falls back to defaults on invalid params (E6), never throws", () => {
  expect(parseCalendarParams({ view: "foo", d: "not-a-date" }, TODAY)).toEqual({
    view: "week",
    anchorIso: "2026-07-03",
  });
  expect(parseCalendarParams({ d: "2026-13-40" }, TODAY).anchorIso).toBe("2026-07-03");
});

// Civil columns have precise half-open bounds in the selected account zone.
it("selectWindow: week range covers exactly its seven UTC civil days by default", () => {
  const { days, range } = selectWindow("week", "2026-07-03"); // week Mon Jun 29 .. Sun Jul 5
  expect(days).toHaveLength(7);
  expect(days[0]?.toISOString().slice(0, 10)).toBe("2026-06-29");
  expect(range.from.toISOString()).toBe("2026-06-29T00:00:00.000Z");
  expect(range.to.toISOString()).toBe("2026-07-06T00:00:00.000Z");
});

it("selectWindow: month range covers the full 42-cell grid", () => {
  const { days, range } = selectWindow("month", "2026-06-15");
  expect(days).toHaveLength(42);
  expect(range.from.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  expect(range.to.toISOString()).toBe("2026-07-13T00:00:00.000Z");
});

it.each([
  ["2026-03-29", "2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"],
  ["2026-10-25", "2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"],
])(
  "selectWindow: day %s follows account midnight through daylight-saving changes",
  (iso, from, to) => {
    const { days, range } = selectWindow("day", iso, { timeZone: "Europe/Berlin" });
    expect(days.map((day) => day.toISOString().slice(0, 10))).toEqual([iso]);
    expect(range.from.toISOString()).toBe(from);
    expect(range.to.toISOString()).toBe(to);
  },
);

it("selectWindow: year includes leap day and excludes neighboring years", () => {
  const { days, range } = selectWindow("year", "2024-11-05", { timeZone: "Europe/Berlin" });
  expect(days).toHaveLength(366);
  expect(days[0]?.toISOString().slice(0, 10)).toBe("2024-01-01");
  expect(days[365]?.toISOString().slice(0, 10)).toBe("2024-12-31");
  expect(days.some((day) => day.toISOString().startsWith("2024-02-29"))).toBe(true);
  expect(range.from.toISOString()).toBe("2023-12-31T23:00:00.000Z");
  expect(range.to.toISOString()).toBe("2024-12-31T23:00:00.000Z");
  expect(selectWindow("year", "2026-11-05").days).toHaveLength(365);
});

it("stepAnchorIso: week steps by 7 days, month by one clamped month", () => {
  expect(stepAnchorIso("week", "2026-07-03", 1)).toBe("2026-07-10");
  expect(stepAnchorIso("week", "2026-07-03", -1)).toBe("2026-06-26");
  expect(stepAnchorIso("month", "2026-01-31", 1)).toBe("2026-02-28");
  expect(stepAnchorIso("month", "2026-06-15", -1)).toBe("2026-05-15");
});

it("steps days across year boundaries and years with leap-day clamping", () => {
  expect(stepAnchorIso("day", "2026-12-31", 1)).toBe("2027-01-01");
  expect(stepAnchorIso("day", "2026-01-01", -1)).toBe("2025-12-31");
  expect(stepAnchorIso("year", "2024-02-29", 1)).toBe("2025-02-28");
  expect(stepAnchorIso("year", "2024-02-29", -1)).toBe("2023-02-28");
  expect(stepAnchorIso("year", "2026-11-05", 1)).toBe("2027-11-05");
});

it("formats day and year titles in the selected language", () => {
  expect(dayTitle("2026-11-05")).toBe("Thursday, November 5, 2026");
  expect(dayTitle("2026-11-05", { locale: "de" })).toBe("Donnerstag, 5. November 2026");
  expect(yearTitle("2026-11-05")).toBe("2026");
});

it("monthTitle formats the anchor month in UTC", () => {
  expect(monthTitle("2026-06-15")).toBe("June 2026");
  expect(monthTitle("2026-12-01")).toBe("December 2026");
});
