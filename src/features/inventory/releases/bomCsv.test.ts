import { expect, test } from "vitest";
import { inspectReleaseBom, parseReleaseBom } from "./bomCsv";
import { wholeBomQuantity } from "./bomUnits";

test("keeps legacy parsed JSON and accepts exact stock revisions and extended BOM fields", () => {
  expect(parseReleaseBom(Buffer.from("sku,quantity\nPART-1,2"))).toEqual([
    { sku: "PART-1", quantity: 2 },
  ]);
  expect(
    parseReleaseBom(
      Buffer.from(
        'sku,quantity,unit,child_release,alternates,optional,consumable,inherited,pieces\r\n"wire@rev B",0.75,m,,"wire@rev C | wire2",TRUE,false,,3\r\nlayout-a,1,each,B2,,,,true,\r\n',
      ),
    ),
  ).toEqual([
    {
      sku: "WIRE@REV B",
      quantity: 0.75,
      details: {
        enteredQuantity: "0.75",
        unit: "m",
        childRelease: null,
        alternateSkus: ["WIRE@REV C", "WIRE2"],
        optional: true,
        consumable: false,
        inherited: false,
        pieces: 3,
      },
    },
    {
      sku: "LAYOUT-A",
      quantity: 1,
      details: {
        enteredQuantity: "1",
        unit: "each",
        childRelease: "B2",
        alternateSkus: [],
        optional: false,
        consumable: false,
        inherited: true,
        pieces: null,
      },
    },
  ]);
});

test("reports the physical line for malformed quantities, BOM options or duplicate selectors", () => {
  expect(
    inspectReleaseBom(Buffer.from("sku,quantity,unit\nPART-1,2,each\n\nPART-1,3,each")),
  ).toEqual({
    ok: false,
    error: "BOM row 4 repeats a material selector.",
  });
  for (const row of [
    "PART-1,0.1,",
    "PART-1,1000000.000001,m",
    "PART-1,0.0000001,m",
    'PART-1,"2,mm',
    "PART-1,2,yard",
  ]) {
    expect(inspectReleaseBom(Buffer.from(`sku,quantity,unit\n${row}`))).toMatchObject({
      ok: false,
      error: expect.stringContaining("BOM row 2"),
    });
  }
  expect(
    parseReleaseBom(Buffer.from("sku,quantity,child_release,alternates\nPCBA,2,A,PCBB")),
  ).toBeNull();
  expect(parseReleaseBom(Buffer.from("sku,quantity,inherited\nPCBA,2,true"))).toBeNull();
  expect(parseReleaseBom(Buffer.from("sku,quantity,unit,unit\nPART-1,2,mm,m"))).toBeNull();
});

test("converts fractional engineering units without rounding physical stock quantities", () => {
  expect(wholeBomQuantity("0.750", "m", "mm")).toBe(750);
  expect(wholeBomQuantity("2000", "mm", "m")).toBe(2);
  expect(wholeBomQuantity("0.000001", "kg", "mg")).toBe(1);
  expect(wholeBomQuantity("1.000001", "m", "mm")).toBeNull();
  expect(wholeBomQuantity("1000000", "m", "um")).toBeNull();
  expect(wholeBomQuantity("2", "each", "mm")).toBeNull();
  expect(wholeBomQuantity("0", "mm", "mm")).toBeNull();
});
