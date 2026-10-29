import { describe, expect, it } from "vitest";
import { createAppTranslator } from "./catalog";
import { mergeMessages } from "./mergeMessages";

describe("message catalogs", () => {
  it("falls back to English for missing or empty translations without losing valid translations", () => {
    expect(
      mergeMessages(
        { form: { save: "Save", cancel: "Cancel" }, title: "CRM" },
        { form: { save: "ذخیره", cancel: "" } },
      ),
    ).toEqual({ form: { save: "ذخیره", cancel: "Cancel" }, title: "CRM" });
  });

  it("formats contextual plurals and interpolated values with ICU", () => {
    const english = createAppTranslator("en", "calendar");
    const persian = createAppTranslator("fa", "calendar");
    expect(english("showMore", { count: 1 })).toBe("Show one more activity");
    expect(english("showMore", { count: 2 })).toBe("Show 2 more activities");
    expect(persian("showMore", { count: 2 })).toContain("۲");
    expect(persian("weekOf", { date: "۱ فروردین" })).toContain("۱ فروردین");
  });
});
