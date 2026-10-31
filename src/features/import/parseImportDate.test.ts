import { expect, it } from "vitest";
import { parseImportDate } from "./parseImportDate";

it("reads a bare date as midnight UTC", () => {
  expect(parseImportDate("2026-03-04")).toBe("2026-03-04T00:00:00.000Z");
});

it("reads an offset-less date and time as UTC, with or without seconds", () => {
  expect(parseImportDate("2026-03-04 09:30")).toBe("2026-03-04T09:30:00.000Z");
  expect(parseImportDate("2026-03-04 09:30:15")).toBe("2026-03-04T09:30:15.000Z");
  expect(parseImportDate("2026-03-04T09:30:15")).toBe("2026-03-04T09:30:15.000Z");
});

it("honors an explicit offset or Z", () => {
  expect(parseImportDate("2026-03-04T09:30:00Z")).toBe("2026-03-04T09:30:00.000Z");
  expect(parseImportDate("2026-03-04T09:30:00+02:00")).toBe("2026-03-04T07:30:00.000Z");
});

it("trims surrounding whitespace", () => {
  expect(parseImportDate("  2026-03-04 ")).toBe("2026-03-04T00:00:00.000Z");
});

it("keeps accepting other Date-parseable strings the old due date field took", () => {
  expect(parseImportDate("March 4, 2026 10:00 UTC")).toBe("2026-03-04T10:00:00.000Z");
});

it("returns null for unparseable or impossible dates", () => {
  expect(parseImportDate("not a date")).toBeNull();
  expect(parseImportDate("2026-02-30")).toBeNull();
  expect(parseImportDate("2026-03-04 25:00")).toBeNull();
  expect(parseImportDate("")).toBeNull();
});

it("reads fractional seconds without an offset as UTC", () => {
  expect(parseImportDate("2026-03-04T09:30:15.123")).toBe("2026-03-04T09:30:15.123Z");
  expect(parseImportDate("2026-03-04 09:30:15.5")).toBe("2026-03-04T09:30:15.500Z");
  expect(parseImportDate("2026-03-04T09:30:15.123456")).toBe("2026-03-04T09:30:15.123Z");
});

it("keeps accepting non-ISO strings the old due date field took", () => {
  for (const value of ["03/04/2026", "March 4, 2026 10:00"]) {
    expect(parseImportDate(value)).toBe(new Date(Date.parse(value)).toISOString());
  }
  expect(parseImportDate("March 4, 2026 10:00 EST")).toBe("2026-03-04T15:00:00.000Z");
});

it("reads a strict offset-less string as UTC whatever the server zone", () => {
  expect(parseImportDate("2026-03-04T09:30:15.123")).toBe("2026-03-04T09:30:15.123Z");
});

it("still honors an explicit offset in a non-ISO string", () => {
  expect(parseImportDate("Wed, 04 Mar 2026 10:00:00 GMT")).toBe("2026-03-04T10:00:00.000Z");
  expect(parseImportDate("2026-03-04T09:30:00.250+02:00")).toBe("2026-03-04T07:30:00.250Z");
});
