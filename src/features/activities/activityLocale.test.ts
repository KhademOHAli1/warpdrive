import { describe, expect, it } from "vitest";
import type { Locale } from "@/features/i18n/registry";
import type { NumberingSystem } from "@/lib/numberingSystem";
import { activitiesMessagesForLocale } from "./activitiesMessages";
import { presetRange } from "./activityDatePresets";
import { isoToDayHeading, isoToDayLabel } from "./dayHeading";
import { fmtDue } from "./dueLabel";

describe("Iranian activity presentation", () => {
  it.each<{
    locale: Locale;
    numberingSystem?: NumberingSystem;
    zero: string;
    one: string;
    many: string;
  }>([
    { locale: "fa", zero: "۰ فعالیت", one: "۱ فعالیت", many: "۱۲ فعالیت" },
    {
      locale: "fa",
      numberingSystem: "arabext",
      zero: "۰ فعالیت",
      one: "۱ فعالیت",
      many: "۱۲ فعالیت",
    },
    { locale: "fa", numberingSystem: "latn", zero: "0 فعالیت", one: "1 فعالیت", many: "12 فعالیت" },
    { locale: "en", zero: "0 activities", one: "1 activity", many: "12 activities" },
  ])(
    "formats activity counts with $locale/$numberingSystem digits and correct plurals",
    ({ locale, numberingSystem, zero, one, many }) => {
      const messages = activitiesMessagesForLocale(locale, numberingSystem);
      expect(messages.activityCount(0)).toBe(zero);
      expect(messages.activityCount(1)).toBe(one);
      expect(messages.activityCount(12)).toBe(many);
    },
  );

  it("starts the Iranian activity week on Saturday without changing English Monday weeks", () => {
    const today = new Date(2026, 2, 24, 12);
    expect(presetRange("this_week", today, "persian")).toEqual({
      from: "2026-03-21",
      to: "2026-03-27",
    });
    expect(presetRange("this_week", today)).toEqual({ from: "2026-03-23", to: "2026-03-29" });
  });
  it("formats the same civil day in Persian and preserves the English contract", () => {
    expect(isoToDayHeading("2026-03-21")).toBe("Sat 21");
    expect(isoToDayHeading("2026-03-21", { locale: "fa", calendar: "persian" })).toContain("۱");
    expect(isoToDayLabel("2026-03-21", { locale: "fa", calendar: "persian" })).toContain("فروردین");
    expect(fmtDue("2026-03-21T12:00:00Z", true, { locale: "fa", calendar: "persian" })).toContain(
      "فروردین",
    );
  });
  it("evaluates numeric ICU plurals before localizing digits", () => {
    const s = activitiesMessagesForLocale("fa");
    expect(s.activityCount(12)).toBe("۱۲ فعالیت");
    expect(s.activityLoad(2, 5)).toContain("۵");
    expect(s.duration(45)).toBe("۴۵ دقیقه");
  });
});
