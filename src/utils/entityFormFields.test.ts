import { describe, expect, it } from "vitest";
import { orNull, parseMoneyValue, resolveLabelKey } from "./entityFormFields";

describe("orNull", () => {
  it("collapses blank and whitespace to null, trims otherwise", () => {
    expect(orNull(null)).toBeNull();
    expect(orNull(undefined)).toBeNull();
    expect(orNull("   ")).toBeNull();
    expect(orNull("  hi ")).toBe("hi");
  });
});

describe("parseMoneyValue", () => {
  it("treats blank as no value", () => {
    expect(parseMoneyValue("")).toEqual({ ok: true, value: null });
    expect(parseMoneyValue("  ")).toEqual({ ok: true, value: null });
  });

  it("preserves up to four decimal places", () => {
    expect(parseMoneyValue("1200")).toEqual({ ok: true, value: 1200 });
    expect(parseMoneyValue("9.999")).toEqual({ ok: true, value: 9.999 });
    expect(parseMoneyValue("9.994")).toEqual({ ok: true, value: 9.994 });
  });

  it("rejects negative or non-numeric input", () => {
    expect(parseMoneyValue("-5").ok).toBe(false);
    expect(parseMoneyValue("abc").ok).toBe(false);
  });

  it("accepts Iranian and Arabic-script money input with valid separators", () => {
    expect(parseMoneyValue("۱۲٬۳۴۵٫۶۷")).toEqual({ ok: true, value: 12345.67 });
    expect(parseMoneyValue("١٢٣٫٤٥")).toEqual({ ok: true, value: 123.45 });
    expect(parseMoneyValue("1.234,56", "de")).toEqual({ ok: true, value: 1234.56 });
  });

  it.each(["12,34", "۱۲٫۳.۴", "0x10", "1e3", "−۵"])(
    "rejects malformed or negative money %s",
    (value) => {
      expect(parseMoneyValue(value).ok).toBe(false);
    },
  );
});

describe("resolveLabelKey", () => {
  it("keeps any non-blank catalog label name and nulls blanks (labels are user-managed now)", () => {
    expect(resolveLabelKey("Hot")).toBe("Hot");
    expect(resolveLabelKey("Enterprise")).toBe("Enterprise");
    expect(resolveLabelKey("   ")).toBeNull();
    expect(resolveLabelKey(null)).toBeNull();
  });
});
