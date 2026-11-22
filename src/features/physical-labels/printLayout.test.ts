import { describe, expect, it } from "vitest";
import {
  LABEL_PRINT_PROFILES,
  labelContentBox,
  labelMillimetres,
  planLabelPrint,
} from "./printLayout";

describe("physical label print layout", () => {
  it("keeps exact A4 row and column positions when the first sheet is partly used", () => {
    const result = planLabelPrint(LABEL_PRINT_PROFILES.a4, { items: 2, copies: 2, firstCell: 20 });
    expect("layout" in result).toBe(true);
    if (!("layout" in result)) throw new Error("Missing print layout");
    const { paper, pageCapacity, labelCount, pages } = result.layout;
    expect(paper).toEqual({ widthMm: 210, heightMm: 297 });
    expect(pageCapacity).toBe(21);
    expect(labelCount).toBe(4);
    expect(
      pages.map((page) => page.cells.map(({ slot, itemIndex, copy }) => [slot, itemIndex, copy])),
    ).toEqual([
      [
        [20, 0, 1],
        [21, 0, 2],
      ],
      [
        [1, 1, 1],
        [2, 1, 2],
      ],
    ]);
    expect(pages[0]?.cells[0]?.leftMm).toBeCloseTo(73.25);
    expect(pages[0]?.cells[0]?.topMm).toBeCloseTo(243.75);
    expect(pages[1]?.cells[0]?.topMm).toBeCloseTo(15.15);
  });

  it("uses 8.5 × 11 in paper and preserves fractional millimetres", () => {
    const result = planLabelPrint(LABEL_PRINT_PROFILES.letter, {
      items: 30,
      copies: 1,
      firstCell: 1,
    });
    expect("layout" in result).toBe(true);
    if (!("layout" in result)) throw new Error("Missing print layout");
    const { paper, pages } = result.layout;
    expect(paper).toEqual({ widthMm: 215.9, heightMm: 279.4 });
    expect(pages).toHaveLength(1);
    const last = pages[0]?.cells[29];
    expect(last?.leftMm).toBeCloseTo(144.4625);
    expect(last?.topMm).toBeCloseTo(241.3);
    expect(labelMillimetres(last?.leftMm ?? 0)).toBe("144.4625mm");
  });

  it("prints one roll label per page with custom physical edges", () => {
    const profile = {
      ...LABEL_PRINT_PROFILES.roll,
      widthMm: 78,
      heightMm: 42,
      leftMm: 2.5,
      topMm: 1.2,
      bottomMm: 0.6,
    };
    const result = planLabelPrint(profile, { items: 1, copies: 3, firstCell: 1 });
    expect("layout" in result).toBe(true);
    if (!("layout" in result)) throw new Error("Missing print layout");
    expect(result.layout.paper.widthMm).toBeCloseTo(80.5);
    expect(result.layout.paper.heightMm).toBeCloseTo(43.8);
    expect(result.layout.pages.map((page) => page.cells)).toEqual(
      [1, 2, 3].map((copy) => [{ slot: 1, itemIndex: 0, copy, leftMm: 2.5, topMm: 1.2 }]),
    );
  });

  it("rejects clipped cells, invalid roll grid, absent geometry, and over-capacity print jobs", () => {
    const request = { items: 2, copies: 1, firstCell: 1 };
    expect(planLabelPrint({ ...LABEL_PRINT_PROFILES.a4, bottomMm: 15.16 }, request)).toEqual({
      error: "fits",
    });
    expect(planLabelPrint({ ...LABEL_PRINT_PROFILES.roll, rows: 2 }, request)).toEqual({
      error: "profile",
    });
    expect(planLabelPrint({ ...LABEL_PRINT_PROFILES.roll, widthMm: Number.NaN }, request)).toEqual({
      error: "profile",
    });
    expect(planLabelPrint(LABEL_PRINT_PROFILES.a4, { ...request, firstCell: 22 })).toEqual({
      error: "start",
    });
    expect(planLabelPrint(LABEL_PRINT_PROFILES.a4, { ...request, items: 100, copies: 6 })).toEqual({
      error: "quantity",
    });
  });

  it("reserves caption and human-readable space without shrinking an EAN-13 on Letter stock", () => {
    const compact = labelContentBox(LABEL_PRINT_PROFILES.letter, "ean13", true);
    expect(compact.compact).toBe(true);
    expect(compact.maxWidthMm).toBeGreaterThan((95 + 11 + 7) * 0.264);
    expect(compact.maxHeightMm).toBeGreaterThan(18.28);
    const qr = labelContentBox(LABEL_PRINT_PROFILES.a4, "qr", true);
    expect(qr.compact).toBe(false);
    expect(qr.maxWidthMm).toBeCloseTo(61);
    expect(qr.maxHeightMm).toBeCloseTo(25.3);
  });
});
