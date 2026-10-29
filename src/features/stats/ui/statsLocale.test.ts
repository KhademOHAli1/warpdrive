import { describe, expect, it } from "vitest";
import { currentPeriod } from "@/features/goals/goalPeriod";
import { durationDays, monthLabel } from "./Panel";
import { trendTooltipValue } from "./trendTooltip";

const fa = { locale: "fa", calendar: "persian", timeZone: "UTC" } as const;
describe("truthful Persian statistics presentation", () => {
  it("localizes Gregorian aggregation buckets without relabeling them as Iranian months", () => {
    const label = monthLabel("2026-03", fa);
    expect(label).toContain("مارس");
    expect(label).toContain("۲۰۲۶");
    expect(label).not.toMatch(/فروردین|اسفند/);
  });
  it("localizes counts/durations while preserving currency and unchanged business periods", () => {
    expect(durationDays(3.4, fa)).toBe("۳ روز");
    expect(trendTooltipValue(1500, { count: 1 }, "USD", fa)).toContain("۱ فرصت فروش");
    expect(currentPeriod("weekly", "2026-03-24", null, "2026-03-25")).toEqual({
      start: "2026-03-24",
      end: "2026-03-30",
    });
  });
});
