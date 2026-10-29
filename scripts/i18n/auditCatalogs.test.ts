import { describe, expect, it } from "vitest";
import { auditCatalogs } from "./auditCatalogs";

describe("translation catalog contract", () => {
  it("permits locale-specific plural branches while preserving argument contracts", () => {
    expect(
      auditCatalogs({
        en: { count: "{count, plural, one {# task} other {# tasks}}" },
        fa: { count: "{count, plural, one {# فعالیت} other {# فعالیت}}" },
      }),
    ).toEqual([]);
  });

  it("rejects missing keys, extra keys and missing interpolation arguments", () => {
    const issues = auditCatalogs({
      en: { hello: "Hello {name}", save: "Save" },
      fa: { hello: "سلام", extra: "اضافه" },
    });
    expect(issues.map((issue) => issue.code).sort()).toEqual([
      "arguments",
      "extra-key",
      "missing-key",
    ]);
  });

  it("rejects invalid ICU syntax and keys which next-intl cannot address", () => {
    const issues = auditCatalogs({
      en: { hello: "Hello {name}" },
      fa: { hello: "سلام {name", "invalid.key": "نامعتبر" },
    });
    expect(issues.some((issue) => issue.code === "icu")).toBe(true);
    expect(issues.some((issue) => issue.code === "invalid-key")).toBe(true);
  });

  it("preserves select identifiers and explicit plural rules", () => {
    const issues = auditCatalogs({
      en: {
        role: "{role, select, admin {Admin} other {Member}}",
        count: "{count, plural, =0 {None} other {#}}",
      },
      fa: { role: "{role, select, owner {مدیر} other {عضو}}", count: "{count, plural, other {#}}" },
    });
    expect(issues.filter((issue) => issue.code === "arguments")).toHaveLength(2);
  });

  it("rejects empty translations and a missing source catalog", () => {
    expect(
      auditCatalogs({ en: { save: "Save" }, fa: { save: " " } }).some(
        (issue) => issue.code === "invalid-value",
      ),
    ).toBe(true);
    expect(
      auditCatalogs({ fa: { save: "ذخیره" } }).some((issue) => issue.code === "invalid-value"),
    ).toBe(true);
  });

  it("detects copied source-language sentences while allowing reviewed invariant names", () => {
    const catalogs = {
      en: { save: "Save changes", brand: "Google", count: "{count, number}" },
      fa: { save: "Save changes", brand: "Google", count: "{count, number}" },
    };
    expect(
      auditCatalogs(catalogs)
        .filter((issue) => issue.code === "untranslated")
        .map((issue) => issue.key),
    ).toEqual(["save", "brand"]);
    expect(
      auditCatalogs(catalogs, "en", { fa: new Set(["brand"]) })
        .filter((issue) => issue.code === "untranslated")
        .map((issue) => issue.key),
    ).toEqual(["save"]);
  });
});
