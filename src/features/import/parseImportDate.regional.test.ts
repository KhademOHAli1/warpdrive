import { expect, it } from "vitest";
import { validateMappedRow } from "./mapRow";
import { parseImportDate } from "./parseImportDate";

it("interprets Persian dates only when the mapping explicitly selects that calendar and time zone", () => {
  expect(
    parseImportDate("۱۴۰۵/۰۱/۰۱ ۰۹:۳۰", { dateCalendar: "persian", dateTimeZone: "Asia/Tehran" }),
  ).toBe("2026-03-21T06:00:00.000Z");
  expect(
    parseImportDate("۱۴۰۵-۰۱-۰۱", { dateCalendar: "persian", dateTimeZone: "Asia/Tehran" }),
  ).toBe("2026-03-20T20:30:00.000Z");
  expect(parseImportDate("1405-01-01")).toBe("1405-01-01T00:00:00.000Z");
});

it("fails nonexistent or ambiguous Berlin wall times until the source supplies an explicit offset", () => {
  const options = { dateCalendar: "gregory" as const, dateTimeZone: "Europe/Berlin" };
  expect(parseImportDate("2026-03-29 02:30", options)).toBeNull();
  expect(parseImportDate("2026-10-25 02:30", options)).toBeNull();
  expect(parseImportDate("2026-10-25T02:30:00+02:00", options)).toBe("2026-10-25T00:30:00.000Z");
  expect(parseImportDate("2026-10-25T02:30:00+01:00", options)).toBe("2026-10-25T01:30:00.000Z");
});

it("keeps explicit Gregorian instants unchanged even when Persian calendar is selected", () => {
  expect(
    parseImportDate("2026-03-21T09:30:00Z", {
      dateCalendar: "persian",
      dateTimeZone: "Asia/Tehran",
    }),
  ).toBe("2026-03-21T09:30:00.000Z");
});

it("keeps a close date civil and gives configured date-only activities canonical all-day metadata", () => {
  const options = { dateCalendar: "persian" as const, dateTimeZone: "Asia/Tehran" };
  const deal = validateMappedRow(
    "deal",
    { primary: { title: "نمونه", expectedCloseDate: "۱۴۰۵/۰۱/۰۱", customFields: {} } },
    [],
    "csv",
    options,
  );
  expect(deal.ok).toBe(true);
  if (deal.ok) expect(deal.value.primary.expectedCloseDate).toBe("2026-03-21");
  const activity = validateMappedRow(
    "activity",
    { primary: { subject: "تماس", dueAt: "۱۴۰۵/۰۱/۰۱", customFields: {} } },
    [],
    "csv",
    options,
  );
  expect(activity.ok).toBe(true);
  if (activity.ok)
    expect(activity.value.primary).toMatchObject({
      dueAt: "2026-03-20T20:30:00.000Z",
      dueDate: "2026-03-21",
      allDay: true,
    });
});

it("supports explicit German dotted dates without guessing slash date order", () => {
  const options = { dateCalendar: "gregory" as const, dateTimeZone: "Europe/Berlin" };
  expect(parseImportDate("04.03.2026 9:30:15.5", options)).toBe("2026-03-04T08:30:15.500Z");
  expect(parseImportDate("04/03/2026 09:30", options)).toBeNull();
});
