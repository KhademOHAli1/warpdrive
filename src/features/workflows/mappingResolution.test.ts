import { expect, it } from "vitest";
import { resolveMapping } from "./mappingResolution";
import type { MappingOutput, MappingValueContract } from "./mappingTypes";
import type { RunOutputs, StepOutput } from "./runTypes";

const reference = { kind: "reference", nodeId: "read", path: ["expectedCloseDate"] };
const date: MappingOutput = {
  nodeId: "read",
  path: ["expectedCloseDate"],
  field: "expectedCloseDate",
  contract: { kind: "date", nullable: true },
};
function output(contract: MappingValueContract): MappingOutput {
  return { ...date, contract };
}

it.each([
  [false, "boolean"],
  [0, "number"],
  ["", "text"],
  ["0012.3400", "text"],
] as const)("retains actual literal %j without inference or coercion", (value, kind) => {
  expect(resolveMapping({ kind: "value", value }, {})).toEqual({
    state: "value",
    value,
    contract: { kind, nullable: false },
  });
});

it.each([
  ["date", "2028-02-29"],
  ["instant", "2030-03-20T12:00:00.123456789+01:30"],
] as const)(
  "qualifies a valid explicit %s intent without rewriting its wire",
  (literalType, value) => {
    expect(resolveMapping({ kind: "value", literalType, value }, {})).toEqual({
      state: "value",
      value,
      contract: { kind: literalType, nullable: false },
    });
  },
);

it.each([
  { kind: "value", value: "12", literalType: "number" },
  { kind: "value", value: "", literalType: "number" },
  { kind: "value", value: "2027-02-29", literalType: "date" },
  { kind: "value", value: "2030-03-20T12:00", literalType: "instant" },
  { kind: "value", value: "2030-03-20", literalType: "instant" },
])("rejects invalid retained typed intent %j", (binding) => {
  expect(resolveMapping(binding, {})).toEqual({ state: "invalid", code: "intent-invalid" });
});

it.each([
  { kind: "value", value: "safe", extra: "hidden" },
  { kind: "reference", nodeId: "read", path: ["expectedCloseDate"], literalType: "date" },
  { kind: "value", value: { date: "2028-02-29" } },
])("rejects unknown or nonscalar binding shapes %j", (binding) => {
  expect(resolveMapping(binding, {}, date)).toEqual({ state: "invalid", code: "binding-invalid" });
});

it("distinguishes absent binding, absent source and absent output property", () => {
  expect(resolveMapping(undefined, {})).toEqual({ state: "missing", reason: "binding-absent" });
  expect(resolveMapping(reference, {}, date)).toEqual({
    state: "missing",
    reason: "source-absent",
  });
  expect(resolveMapping(reference, { read: {} }, date)).toEqual({
    state: "missing",
    reason: "property-absent",
  });
});

it("retains explicit null and never treats it as an absent date", () => {
  expect(resolveMapping(reference, { read: { expectedCloseDate: null } }, date)).toEqual({
    state: "null",
    contract: date.contract,
  });
  expect(resolveMapping({ kind: "value", value: null }, {})).toEqual({ state: "null" });
  expect(
    resolveMapping(
      reference,
      { read: { expectedCloseDate: null } },
      output({ kind: "date", nullable: false }),
    ),
  ).toEqual({ state: "invalid", code: "output-type-invalid" });
});

it("requires the exact qualified source descriptor for a reference", () => {
  const outputs = { read: { expectedCloseDate: "2028-02-29" } };
  expect(resolveMapping(reference, outputs)).toEqual({
    state: "invalid",
    code: "descriptor-missing",
  });
  expect(resolveMapping(reference, outputs, { ...date, nodeId: "other" })).toEqual({
    state: "invalid",
    code: "descriptor-missing",
  });
  expect(resolveMapping(reference, outputs, { ...date, path: ["title"] })).toEqual({
    state: "invalid",
    code: "descriptor-missing",
  });
  expect(resolveMapping(reference, outputs, date)).toEqual({
    state: "value",
    value: "2028-02-29",
    contract: date.contract,
  });
});

it("reads only own node and flattened own output keys", () => {
  const inheritedSource: RunOutputs = {};
  Object.setPrototypeOf(inheritedSource, { read: { expectedCloseDate: "2028-02-29" } });
  const inheritedOutput: StepOutput = {};
  Object.setPrototypeOf(inheritedOutput, { expectedCloseDate: "2028-02-29" });
  const inheritedValue: RunOutputs = { read: inheritedOutput };
  expect(resolveMapping(reference, inheritedSource, date)).toEqual({
    state: "missing",
    reason: "source-absent",
  });
  expect(resolveMapping(reference, inheritedValue, date)).toEqual({
    state: "missing",
    reason: "property-absent",
  });
});

it.each([
  ["2027-02-29", { kind: "date", nullable: true }],
  ["2030-03-20", { kind: "instant", nullable: false }],
  ["12.00", { kind: "number", nullable: false }],
  [12, { kind: "decimal", nullable: false }],
  ["2028-02-29", { kind: "entity", nullable: false, entity: "user" }],
] satisfies [string | number, MappingValueContract][])(
  "rejects a receipt that violates its declared output type %j",
  (value, contract) => {
    // Raw storage is untrusted; this also covers historical or corrupt JSON receipts.
    const raw: RunOutputs = { read: { expectedCloseDate: value } };
    expect(resolveMapping(reference, raw, output(contract))).toEqual({
      state: "invalid",
      code: "output-type-invalid",
    });
  },
);

it("retains exact decimal and user identity outputs without transforming them", () => {
  const value = "0012.3400";
  const contract: MappingValueContract = { kind: "decimal", nullable: true };
  expect(
    resolveMapping(reference, { read: { expectedCloseDate: value } }, output(contract)),
  ).toEqual({ state: "value", value, contract });
  const user = crypto.randomUUID();
  const userContract: MappingValueContract = { kind: "entity", entity: "user", nullable: false };
  expect(
    resolveMapping(reference, { read: { expectedCloseDate: user } }, output(userContract)),
  ).toEqual({ state: "value", value: user, contract: userContract });
});
