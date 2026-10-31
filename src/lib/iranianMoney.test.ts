import { describe, expect, it } from "vitest";
import { formatCurrency } from "./formatCurrency";

describe("approved exact rial/toman presentation", () => {
  it.each([
    ["1234560", "123,456 toman"],
    ["1", "0.1 toman"],
    ["0.0001", "0.00001 toman"],
    ["99999999999999.9999", "9,999,999,999,999.99999 toman"],
  ])("displays canonical IRR %s in toman without rounding", (canonical, expected) => {
    expect(formatCurrency(canonical, "IRR", { locale: "en", iranianMoneyUnit: "toman" })).toBe(
      expected,
    );
  });
  it("changes language and separators without changing the selected currency or unit", () => {
    expect(formatCurrency("1234560", "IRR", { locale: "de", iranianMoneyUnit: "toman" })).toBe(
      "123.456 Toman",
    );
    expect(formatCurrency("1234560", "IRR", { locale: "fa", iranianMoneyUnit: "toman" })).toBe(
      "۱۲۳٬۴۵۶ تومان",
    );
    expect(
      formatCurrency("1", "IRR", {
        locale: "fa",
        numberingSystem: "latn",
        iranianMoneyUnit: "toman",
      }),
    ).toBe("0.1 تومان");
    expect(formatCurrency("1234.50", "EUR", { locale: "de", iranianMoneyUnit: "toman" })).toBe(
      "1.234,5 €",
    );
  });
  it("keeps default rial presentation and rejects malformed unit-conversion inputs", () => {
    expect(formatCurrency("1234560", "IRR", { locale: "en" })).toBe(
      formatCurrency("1234560", "IRR", { locale: "en", iranianMoneyUnit: "rial" }),
    );
    for (const invalid of ["1,234", "1.00001", "1e3", "", "NaN"])
      expect(formatCurrency(invalid, "IRR", { iranianMoneyUnit: "toman" })).toBe("");
  });
});
