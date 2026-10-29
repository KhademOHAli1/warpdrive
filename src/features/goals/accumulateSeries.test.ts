import { describe, expect, it } from "vitest";
import { accumulateSeries } from "./accumulateSeries";

describe("daily goal totals", () => {
  it("preserves third and fourth decimal places across days", () => {
    const days = ["2026-10-01", "2026-10-02", "2026-10-03"];
    expect(
      accumulateSeries(
        days,
        new Map([
          [days[0] ?? "", { count: 1, value: "0.001" }],
          [days[1] ?? "", { count: 1, value: "0.0025" }],
        ]),
        "value",
        "KWD",
      ).map((point) => point.actual),
    ).toEqual(["0.001", "0.0035", "0.0035"]);
  });

  it("keeps count goals independent of monetary amounts", () => {
    expect(
      accumulateSeries(
        ["2026-10-01"],
        new Map([["2026-10-01", { count: 3, value: "100000.0000" }]]),
        "count",
        "USD",
      )[0]?.actual,
    ).toBe("3");
  });
});
