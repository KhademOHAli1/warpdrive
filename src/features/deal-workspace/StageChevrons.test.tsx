// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { accentForOrder, tint } from "@/features/deals/boardStageHeader";
import { StageChevrons } from "./StageChevrons";

afterEach(cleanup);

function alphaOf(rgba: string): number {
  const m = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(rgba);
  return m === null ? Number.NaN : Number.parseFloat(m[1] ?? "");
}
function rgbPrefix(rgba: string): string {
  const m = /^(rgba\(\d+, \d+, \d+),/.exec(rgba);
  return m?.[1] ?? "";
}

describe("StageChevrons", () => {
  it("tints each segment in its stage's pipeline hue with progress-fill intensity, not green/gray", () => {
    const { getByText } = render(
      <StageChevrons
        chips={[
          { id: "a", name: "Qualified", current: false, passed: true }, // order 0 -> slate
          { id: "b", name: "Contact", current: true, passed: false }, // order 1 -> blue
          { id: "c", name: "Proposal", current: false, passed: false }, // order 2 -> indigo
        ]}
      />,
    );
    const segment = (name: string): HTMLElement => {
      const item = getByText(name).closest("li");
      if (item === null) throw new Error(`Missing stage segment: ${name}`);
      return item;
    };

    // Each segment reads in its own order-hue (inherited from the pipeline board).
    expect(rgbPrefix(segment("Qualified").style.backgroundColor)).toBe(
      rgbPrefix(tint(accentForOrder(0), 1)),
    );
    expect(rgbPrefix(segment("Contact").style.backgroundColor)).toBe(
      rgbPrefix(tint(accentForOrder(1), 1)),
    );
    expect(rgbPrefix(segment("Proposal").style.backgroundColor)).toBe(
      rgbPrefix(tint(accentForOrder(2), 1)),
    );

    // Progress reads via fill intensity, and no leftover uniform token classes remain.
    const passed = alphaOf(segment("Qualified").style.backgroundColor);
    const current = alphaOf(segment("Contact").style.backgroundColor);
    const future = alphaOf(segment("Proposal").style.backgroundColor);
    expect(passed).toBeGreaterThan(future);
    expect(current).toBeGreaterThanOrEqual(passed);
    for (const seg of ["Qualified", "Contact", "Proposal"]) {
      expect(segment(seg).className).not.toContain("bg-success");
      expect(segment(seg).className).not.toContain("bg-muted");
      expect(segment(seg).className).not.toContain("bg-primary");
    }
  });
});
