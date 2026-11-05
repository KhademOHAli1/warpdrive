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

  it("keeps Swiss German decimals exact and accepts either apostrophe used for grouping", () => {
    expect(normalizeNumberInput("1.234", "de-CH")).toBe("1.234");
    expect(normalizeNumberInput("1’234.5678", "de-CH")).toBe("1234.5678");
    expect(normalizeNumberInput("1'234.500", "de-CH-u-nu-latn")).toBe("1234.500");
    expect(normalizeNumberInput("9007199254740993.123400", "de-CH")).toBe(
      "9007199254740993.123400",
    );
    expect(normalizeNumberInput("12’34.5", "de-CH")).toBeNull();
    expect(normalizeNumberInput("1,234", "de-CH")).toBeNull();
    expect(normalizeNumberInput("1’234'567.89", "de-CH")).toBeNull();
    expect(normalizeNumberInput("1.234", "de-DE")).toBe("1234");
  });

  it("uses regional grouping and reads Persian numerals with either punctuation", () => {
    expect(normalizeNumberInput("12,34,567.89", "en-IN")).toBe("1234567.89");
    expect(normalizeNumberInput("1,234,567.89", "en-IN")).toBeNull();
    expect(normalizeNumberInput("\u200e−۱۲٬۳۴۵٫۶۷", "fa-IR")).toBe("-12345.67");
    expect(normalizeNumberInput("۱۲۳.۴۵", "fa-IR-u-nu-arabext")).toBe("123.45");
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
