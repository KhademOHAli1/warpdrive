import { describe, expect, it } from "vitest";
import { canonicalCreateDates, canonicalUpdateDates } from "./activityTemporalWrite";

describe("canonical activity civil dates", () => {
  it("records a new Iranian all-day civil date without changing its compatibility instant", () => {
    expect(
      canonicalCreateDates(
        { dueAt: "2026-03-20T20:30:00.000Z", allDay: true, endAt: null },
        "Asia/Tehran",
      ),
    ).toEqual({ dueDate: "2026-03-21", endDate: null });
  });
  it("does not infer/backfill a legacy day on unrelated or same-instant edits", () => {
    const current = {
      dueAt: new Date("2026-03-20T20:30Z"),
      endAt: null,
      allDay: true,
      dueDate: null,
      endDate: null,
    };
    expect(canonicalUpdateDates(current, {}, "Asia/Tehran")).toEqual({});
    expect(
      canonicalUpdateDates(
        current,
        { dueAt: "2026-03-20T20:30:00.000Z", allDay: true },
        "Asia/Tehran",
      ),
    ).toEqual({});
    expect(
      canonicalUpdateDates(
        current,
        { dueAt: "2026-03-21T20:30:00.000Z", allDay: true },
        "Asia/Tehran",
      ),
    ).toEqual({ dueDate: "2026-03-22", endDate: null });
  });
  it("clears canonical dates for timed midnight, never treats midnight as all-day", () => {
    expect(canonicalCreateDates({ dueAt: "2026-03-21T00:00Z", allDay: false }, "UTC")).toEqual({
      dueDate: null,
      endDate: null,
    });
  });
});
