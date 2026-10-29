import { describe, expect, it } from "vitest";
import { formatChangeLabel } from "@/features/deal-workspace/changeLabel";
import { providerName } from "./providerNames";

describe("provider display names", () => {
  it("preserves known provider brands", () => {
    expect(providerName("apollo")).toBe("Apollo");
    expect(providerName("rocketreach")).toBe("RocketReach");
    expect(providerName("getprospect")).toBe("GetProspect");
  });

  it("preserves unknown and prototype-like IDs as plain strings", () => {
    for (const id of [
      "future_provider",
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
      "",
    ]) {
      expect(providerName(id)).toBe(id);
    }
  });

  it("keeps audit wording and renders prototype-like provider IDs as data", () => {
    const entry = {
      field: "org.industry",
      oldValue: "Retail",
      newValue: { value: "Fintech", providers: ["apollo", "constructor", "__proto__"] },
    };
    expect(formatChangeLabel(entry, "en")).toBe(
      "Industry: Retail → Fintech (from Apollo, constructor and __proto__)",
    );
    const persian = formatChangeLabel(entry, "fa");
    expect(persian).toContain("constructor");
    expect(persian).toContain("__proto__");
    expect(persian).not.toContain("[object Object]");
    expect(persian).not.toContain("function");
  });
});
