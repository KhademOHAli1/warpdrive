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

describe("German statistics and independent numbering preferences", () => {
  it("uses German durations and computed tooltip plurals", () => {
    const de = { locale: "de", calendar: "gregory", timeZone: "UTC" } as const;
    expect(durationDays(0.2, de)).toBe("Weniger als ein Tag");
    expect(durationDays(2, de)).toBe("2 Tage");
    expect(trendTooltipValue(1500, { count: 1 }, "EUR", de)).toMatch(/aus 1 Verkaufschance$/);
    expect(trendTooltipValue(1500, { count: 2 }, "EUR", de)).toMatch(/aus 2 Verkaufschancen$/);
    expect(monthLabel("2026-03", de)).toBe("März 2026");
  });
  it("honors Persian Latin-digit overrides in months, durations and tooltip counts", () => {
    const preferences = { ...fa, numberingSystem: "latn" } as const;
    expect(monthLabel("2026-03", preferences)).toContain("2026");
    expect(durationDays(3, preferences)).toBe("3 روز");
    expect(trendTooltipValue(1500, { count: 12 }, "USD", preferences)).toContain("12 فرصت فروش");
  });
});
