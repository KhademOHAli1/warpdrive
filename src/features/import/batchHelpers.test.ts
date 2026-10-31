import { describe, expect, it } from "vitest";
import { AppError } from "@/constants/errorIds";
import { narrowSource } from "./batchHelpers";

describe("narrowSource", () => {
  it("passes known sources through", () => {
    expect(narrowSource("csv")).toBe("csv");
    expect(narrowSource("pipedrive")).toBe("pipedrive");
  });

  it("throws on an unknown stored source", () => {
    expect(() => narrowSource("hubspot")).toThrow(AppError);
  });
});
