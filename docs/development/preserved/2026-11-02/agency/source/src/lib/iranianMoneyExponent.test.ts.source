import { describe, expect, it } from "vitest";
import { formatCurrency } from "./formatCurrency";
import { irrToToman } from "./iranianMoney";

const preferences = {
  locale: "en",
  numberingSystem: "latn",
  iranianMoneyUnit: "toman",
} as const;

const exponentAmounts = [
  {
    label: "positive exponent",
    numeric: 1e21,
    expanded: "1000000000000000000000",
    toman: "100000000000000000000",
    display: "100,000,000,000,000,000,000\u00a0toman",
  },
  {
    label: "negative exponent",
    numeric: -1e21,
    expanded: "-1000000000000000000000",
    toman: "-100000000000000000000",
    display: "-100,000,000,000,000,000,000\u00a0toman",
  },
];

const exactControls = [
  { label: "zero", value: 0, toman: "0", display: "0\u00a0toman" },
  { label: "signed zero", value: -0, toman: "0", display: "0\u00a0toman" },
  {
    label: "smallest four-place canonical fraction",
    value: "0.0001",
    toman: "0.00001",
    display: "0.00001\u00a0toman",
  },
  {
    label: "negative large exact decimal string",
    value: "-99999999999999.9999",
    toman: "-9999999999999.99999",
    display: "-9,999,999,999,999.99999\u00a0toman",
  },
];

describe("supported numeric amounts in exact toman presentation", () => {
  it.each(exponentAmounts)(
    "preserves a supported $label amount and its expanded decimal equivalent",
    ({ numeric, expanded, toman, display }) => {
      expect(irrToToman(numeric)).toBe(toman);
      expect(irrToToman(expanded)).toBe(toman);

      const numericDisplay = formatCurrency(numeric, "IRR", preferences);
      const expandedDisplay = formatCurrency(expanded, "IRR", preferences);
      expect(numericDisplay).not.toBe("");
      expect(numericDisplay).toBe(expandedDisplay);
      expect(numericDisplay).toBe(display);
    },
  );

  it("preserves a finite numeric amount beyond the bounded string-input magnitude", () => {
    const expectedToman = `1${"0".repeat(99)}`;
    expect(irrToToman(1e100)).toBe(expectedToman);
    expect(formatCurrency(1e100, "IRR", preferences)).not.toBe("");
  });

  it.each(exactControls)("retains $label behavior", ({ value, toman, display }) => {
    expect(irrToToman(value)).toBe(toman);
    expect(formatCurrency(value, "IRR", preferences)).toBe(display);
  });
});
