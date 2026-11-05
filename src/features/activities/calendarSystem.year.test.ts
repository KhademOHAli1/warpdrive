import { expect, it } from "vitest";
import { calendarYearMonths, formatCalendarDate } from "./calendarSystem";

it("provides January through December from any Gregorian year anchor", () => {
  expect(
    calendarYearMonths(new Date("2026-11-05T00:00:00Z")).map((day) =>
      day.toISOString().slice(0, 10),
    ),
  ).toEqual([
    "2026-01-01",
    "2026-02-01",
    "2026-03-01",
    "2026-04-01",
    "2026-05-01",
    "2026-06-01",
    "2026-07-01",
    "2026-08-01",
    "2026-09-01",
    "2026-10-01",
    "2026-11-01",
    "2026-12-01",
  ]);
});

it("provides the twelve actual Iranian month starts within the selected year", () => {
  const options = { calendar: "persian", locale: "fa", numberingSystem: "latn" } as const;
  const months = calendarYearMonths(new Date("2026-11-05T00:00:00Z"), options);
  expect(months.map((day) => day.toISOString().slice(0, 10))).toEqual([
    "2026-03-21",
    "2026-04-21",
    "2026-05-22",
    "2026-06-22",
    "2026-07-23",
    "2026-08-23",
    "2026-09-23",
    "2026-10-23",
    "2026-11-22",
    "2026-12-22",
    "2027-01-21",
    "2027-02-20",
  ]);
  expect(months.map((day) => formatCalendarDate(day, options, { day: "numeric" }))).toEqual(
    Array(12).fill("1"),
  );
});
