import { describe, expect, it } from "vitest";
import { checkoutBlocksPurchase } from "./checkoutPolicy";

describe("replacement checkout admission", () => {
  it.each([
    ["open", null, true],
    ["expired", null, false],
    ["complete", "active", true],
    ["complete", "canceled", false],
    ["complete", "incomplete_expired", false],
    ["complete", null, true],
  ])(
    "checkout %s with subscription %s blocks a new purchase: %s",
    (checkout, subscription, expected) => {
      expect(checkoutBlocksPurchase(checkout, subscription)).toBe(expected);
    },
  );
});
