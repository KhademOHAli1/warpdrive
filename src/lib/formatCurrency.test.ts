import { describe, expect, it } from "vitest";
import { formatCurrency } from "./formatCurrency";

describe("formatCurrency", () => {
  it("does not lose minor units in large aggregated decimal strings", () => {
    expect(formatCurrency("1234567890123456.125", "USD")).toBe("$1,234,567,890,123,456.125");
  });
  it("formats a decimal string as a whole-dollar amount with a thousands separator", () => {
    expect(formatCurrency("25000.00")).toBe("$25,000");
  });

  it("preserves fractional amounts", () => {
    expect(formatCurrency("1234567.89")).toBe("$1,234,567.89");
  });

  it("formats zero", () => {
    expect(formatCurrency("0")).toBe("$0");
  });

  it("accepts a number", () => {
    expect(formatCurrency(4200)).toBe("$4,200");
  });

  it("returns empty string for non-numeric input", () => {
    expect(formatCurrency("abc")).toBe("");
  });

  it("honors a non-default currency", () => {
    expect(formatCurrency("1000", "EUR")).toBe("€1,000");
  });

  it("uses the selected locale's digits without changing the stored currency", () => {
    const formatted = formatCurrency("1234.50", "USD", { locale: "fa" });
    expect(formatted).toContain("۱٬۲۳۴٫۵");
    expect(formatted).toContain("$");
    expect(formatted).not.toContain("ریال");
    expect(formatCurrency("1234.50", "EUR", { locale: "de" })).toBe("1.234,5 €");
  });

  it("does not display infinity as a monetary amount", () => {
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe("");
  });
});
