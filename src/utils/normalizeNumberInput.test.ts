import { describe, expect, it } from "vitest";
import { normalizeNumberInput } from "./normalizeNumberInput";

describe("normalizeNumberInput", () => {
  it("normalizes Persian and Arabic digits and separators to a canonical decimal", () => {
    expect(normalizeNumberInput("۱۲٬۳۴۵٫۶۷")).toBe("12345.67");
    expect(normalizeNumberInput("١٢٬٣٤٥٫٦٧")).toBe("12345.67");
    expect(normalizeNumberInput(" ۱۲۳.۴۵ ")).toBe("123.45");
    expect(normalizeNumberInput("−۱۲٫۵")).toBe("-12.5");
  });

  it("honors explicit German decimal and grouping conventions", () => {
    expect(normalizeNumberInput("1.234,56", "de")).toBe("1234.56");
    expect(normalizeNumberInput("1,234.56", "en")).toBe("1234.56");
    expect(normalizeNumberInput("1.234", "de")).toBe("1234");
    expect(normalizeNumberInput("1.234", "en")).toBe("1.234");
  });

  it.each([
    "12,34",
    "1,,234",
    "1,234٬567",
    "1.2.3",
    "۱۲٫۳.۴",
    "0x10",
    "1e3",
    "Infinity",
    ".",
    "",
    "1 234",
    "۱۲،۳۴",
  ])("rejects malformed or ambiguous input %s", (value) => {
    expect(normalizeNumberInput(value)).toBeNull();
  });

  it("accepts plain decimals and a fractional value without an integer part", () => {
    expect(normalizeNumberInput(".5")).toBe(".5");
    expect(normalizeNumberInput("+5")).toBe("+5");
    expect(normalizeNumberInput("5.")).toBe("5.");
  });
});
