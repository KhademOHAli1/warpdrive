import { describe, expect, it } from "vitest";
import { sortBoardCards } from "@/features/deals/boardSort";
import { baseCard } from "@/features/deals/dealCardTestFixture";
import { parseMoneyValue } from "@/utils/entityFormFields";
import { CURRENCY_CODES, HISTORICAL_CURRENCY_CODES } from "./codes";
import { currencyCode, moneyAmount } from "./currencySchema";
import { sumMoney } from "./money";

describe("currency amounts", () => {
  it("orders large amounts without losing their fractional difference", () => {
    const cards = [
      { ...baseCard, id: "a", currency: "IRR", value: "9999999999999.0002" },
      { ...baseCard, id: "b", currency: "IRR", value: "9999999999999.0001" },
    ];
    expect(sortBoardCards(cards, "value", "asc").map((card) => card.id)).toEqual(["b", "a"]);
  });
  it("accepts large native amounts as lossless decimal strings", () => {
    expect(moneyAmount.parse("9999999999999.1234")).toBe("9999999999999.1234");
    expect(parseMoneyValue("9999999999999.1234")).toEqual({
      ok: true,
      value: "9999999999999.1234",
    });
    expect(moneyAmount.safeParse("100000000000000").success).toBe(false);
  });
  it("uses the same current and historical ISO code catalog on every runtime", () => {
    expect(CURRENCY_CODES).toEqual(
      expect.arrayContaining(["USD", "EUR", "IRR", "KWD", "CLF", "SLE", "XAD"]),
    );
    expect(CURRENCY_CODES).not.toContain("BGN");
    expect(HISTORICAL_CURRENCY_CODES).toContain("BGN");
    expect(currencyCode.parse("BGN")).toBe("BGN");
  });
  it("does not round a three-place currency in create or edit forms", () => {
    expect(parseMoneyValue("12.345")).toEqual({ ok: true, value: 12.345 });
    expect(parseMoneyValue("۱۲٫۳۴۵", "fa")).toEqual({ ok: true, value: 12.345 });
    expect(parseMoneyValue("1.23456").ok).toBe(false);
  });
  it("keeps currencies separate and adds decimal amounts exactly", () => {
    expect(
      sumMoney(
        [
          { value: "0.10", currency: "USD" },
          { value: "0.20", currency: "USD" },
          { value: "99.99", currency: "EUR" },
          { value: "12500000", currency: "IRR" },
          { value: null, currency: "JPY" },
        ],
        "USD",
      ),
    ).toEqual([
      { currency: "EUR", value: "99.99" },
      { currency: "IRR", value: "12500000.00" },
      { currency: "USD", value: "0.30" },
    ]);
  });

  it("uses the company currency for legacy client fixtures only", () => {
    expect(sumMoney([{ value: "12.50" }, { value: "1.25", currency: "USD" }], "EUR")).toEqual([
      { currency: "EUR", value: "12.50" },
      { currency: "USD", value: "1.25" },
    ]);
  });

  it("preserves three and four decimal places without rounding", () => {
    expect(
      sumMoney(
        [
          { currency: "KWD", value: "12.345" },
          { currency: "CLF", value: "1.2345" },
        ],
        "USD",
      ),
    ).toEqual([
      { currency: "CLF", value: "1.2345" },
      { currency: "KWD", value: "12.345" },
    ]);
    expect(moneyAmount.safeParse(12.345).success).toBe(true);
    expect(moneyAmount.safeParse(1.2345).success).toBe(true);
    expect(moneyAmount.safeParse(1.23456).success).toBe(false);
  });

  it("validates actual supported currency codes rather than any three letters", () => {
    expect(currencyCode.parse("eur")).toBe("EUR");
    expect(currencyCode.parse("IRR")).toBe("IRR");
    expect(currencyCode.safeParse("XYZ").success).toBe(false);
  });
});
