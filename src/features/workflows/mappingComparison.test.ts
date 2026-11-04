import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { compareMappingValues } from "./mappingComparison";
import { type MappingResolution, resolveMapping } from "./mappingResolution";
import type { MappingOutput, MappingValueContract } from "./mappingTypes";

function value(raw: string | number | boolean | null, kind?: "date" | "instant") {
  return resolveMapping({ kind: "value", value: raw, ...(kind ? { literalType: kind } : {}) }, {});
}
function receipt(raw: string, contract: MappingValueContract): MappingResolution {
  const source: MappingOutput = { nodeId: "read", path: ["value"], field: "value", contract };
  return resolveMapping(
    { kind: "reference", nodeId: "read", path: ["value"] },
    { read: { value: raw } },
    source,
  );
}

it.each([
  ["equals", value("1"), value(1), false],
  ["notEquals", value(false), value(0), true],
  ["equals", value(null), value(null), true],
  ["equals", value(null), value(""), false],
  ["notEquals", value(null), value(0), true],
  ["exists", value(null), undefined, false],
  ["exists", value(false), undefined, true],
  ["exists", value(0), undefined, true],
  ["exists", value(""), undefined, true],
  ["contains", value("پیگیری مشتری"), value("مشتری"), true],
] as const)("keeps %s exact primitive/null semantics", (operator, left, right, result) => {
  expect(compareMappingValues(operator, left, right)).toEqual({ ok: true, value: { result } });
});

it("retains contains for an exact decimal string without numeric coercion", () => {
  const decimal = receipt("0012.3400", { kind: "decimal", nullable: true });
  expect(compareMappingValues("contains", decimal, value(".3400"))).toEqual({
    ok: true,
    value: { result: true },
  });
  expect(compareMappingValues("equals", decimal, value(12.34))).toEqual({
    ok: true,
    value: { result: false },
  });
});

it.each([
  ["2028-02-29", "2028-02-29", true],
  ["2028-02-29", "2028-03-01", false],
] as const)("compares canonical civil dates without timezone conversion", (left, right, result) => {
  expect(compareMappingValues("equals", value(left, "date"), value(right, "date"))).toEqual({
    ok: true,
    value: { result },
  });
});

it.each([
  ["2030-03-20T12:00:00.123456789Z", "2030-03-20T13:00:00.123456789+01:00", true],
  ["2030-03-20T12:00:00.123456789Z", "2030-03-20T12:00:00.123456788Z", false],
] as const)(
  "compares real instants by instant, retaining nanosecond precision",
  (left, right, result) => {
    expect(compareMappingValues("equals", value(left, "instant"), value(right, "instant"))).toEqual(
      { ok: true, value: { result } },
    );
    expect(
      compareMappingValues("notEquals", value(left, "instant"), value(right, "instant")),
    ).toEqual({ ok: true, value: { result: !result } });
  },
);

it.each([
  ["equals", value("2028-02-29", "date"), value("2028-02-29")],
  ["equals", value("2030-03-20", "date"), value("2030-03-20T00:00:00Z", "instant")],
  ["contains", value("2030-03-20T00:00:00Z", "instant"), value("2030")],
  ["contains", value("2028-02-29", "date"), value("02")],
] as const)("rejects incompatible or textual temporal operations", (operator, left, right) => {
  expect(compareMappingValues(operator, left, right)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_INVALID,
  });
});

it("fails missing and invalid operands instead of selecting a false branch", () => {
  const missing: MappingResolution = { state: "missing", reason: "property-absent" };
  const invalid: MappingResolution = { state: "invalid", code: "output-type-invalid" };
  expect(compareMappingValues("exists", missing)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_BINDING_MISSING,
  });
  expect(compareMappingValues("equals", value(null), missing)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_BINDING_MISSING,
  });
  expect(compareMappingValues("equals", invalid, value(null))).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_INVALID,
  });
});
