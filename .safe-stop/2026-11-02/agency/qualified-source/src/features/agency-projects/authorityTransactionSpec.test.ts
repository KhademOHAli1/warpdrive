import { describe, expect, it } from "vitest";
import { parseAuthorityTransactionSpec } from "./authorityTransactionSpec";

const MIN_INT32 = -2_147_483_648;
const MAX_INT32 = 2_147_483_647;
const invalid = { ok: false, error: "invalid_authority_transaction_spec" };
const timeoutFields = ["lockMs", "statementMs", "idleMs"] as const;

function spec() {
  return {
    key: [10_101, 20_202] as [number, number],
    mode: "shared" as const,
    sqlTimeouts: { lockMs: 1_500, statementMs: 3_000, idleMs: 5_000 },
  };
}

function withTimeout(field: string, value: unknown) {
  return { ...spec(), sqlTimeouts: { ...spec().sqlTimeouts, [field]: value } };
}

const invalidKeyValues = [
  undefined,
  null,
  "1",
  true,
  {},
  [],
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  MIN_INT32 - 1,
  MAX_INT32 + 1,
];
const invalidKeyRows = invalidKeyValues.flatMap((value) =>
  ([0, 1] as const).map((index) => ({ index, value })),
);
const invalidTimeoutValues = [
  0,
  -1,
  60_001,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  "1",
  true,
  null,
  undefined,
  {},
];
const invalidTimeoutRows = timeoutFields.flatMap((field) =>
  invalidTimeoutValues.map((value) => ({ field, value })),
);

describe("candidate authority transaction specification boundary", () => {
  it.each(["shared", "exclusive"] as const)("preserves explicit %s mode", (mode) => {
    const input = { ...spec(), mode };
    expect(parseAuthorityTransactionSpec(input)).toEqual({ ok: true, value: input });
  });

  it.each([
    [MIN_INT32, MAX_INT32],
    [MAX_INT32, MIN_INT32],
    [0, 0],
  ])("accepts the exact signed int32 key tuple %j", (first, second) => {
    const input = { ...spec(), key: [first, second] };
    expect(parseAuthorityTransactionSpec(input)).toEqual({ ok: true, value: input });
  });

  it.each([
    [1, 1, 1],
    [60_000, 60_000, 60_000],
    [1, 30_000, 60_000],
  ])("accepts inclusive ordered timeout bounds %j", (lockMs, statementMs, idleMs) => {
    const input = { ...spec(), sqlTimeouts: { lockMs, statementMs, idleMs } };
    expect(parseAuthorityTransactionSpec(input)).toEqual({ ok: true, value: input });
  });

  it.each([null, undefined, [], {}, true, 3, "spec"].map((input) => ({ input })))(
    "rejects a malformed specification: $input",
    ({ input }) => expect(parseAuthorityTransactionSpec(input)).toEqual(invalid),
  );

  it.each(["key", "mode", "sqlTimeouts"] as const)("requires explicit %s", (field) => {
    const input = spec();
    Reflect.deleteProperty(input, field);
    expect(parseAuthorityTransactionSpec(input)).toEqual(invalid);
  });

  it.each(timeoutFields)("requires explicit sqlTimeouts.%s", (field) => {
    const input = spec();
    Reflect.deleteProperty(input.sqlTimeouts, field);
    expect(parseAuthorityTransactionSpec(input)).toEqual(invalid);
  });

  it.each([
    { boundary: "spec", input: { ...spec(), authorized: true } },
    { boundary: "sqlTimeouts", input: withTimeout("totalMs", 10_000) },
  ])("rejects extra keys at $boundary", ({ input }) => {
    expect(parseAuthorityTransactionSpec(input)).toEqual(invalid);
  });

  it.each([null, undefined, "1,2", {}, 3, true])("rejects a non-tuple key: %j", (key) => {
    expect(parseAuthorityTransactionSpec({ ...spec(), key })).toEqual(invalid);
  });

  it.each([[], [1], [1, 2, 3], [1, 2, 3, 4]].map((key) => ({ key })))(
    "requires exactly two key entries: $key",
    ({ key }) => expect(parseAuthorityTransactionSpec({ ...spec(), key })).toEqual(invalid),
  );

  it.each(invalidKeyRows)("rejects invalid key[$index]: $value", ({ index, value }) => {
    const key: unknown[] = [...spec().key];
    key[index] = value;
    expect(parseAuthorityTransactionSpec({ ...spec(), key })).toEqual(invalid);
  });

  it.each([
    undefined,
    null,
    "",
    "SHARED",
    "Exclusive",
    "update",
    " shared",
    "shared ",
    true,
    1,
    {},
  ])("rejects a noncanonical mode: %j", (mode) =>
    expect(parseAuthorityTransactionSpec({ ...spec(), mode })).toEqual(invalid),
  );

  it.each([undefined, null, [], 1, "time"].map((sqlTimeouts) => ({ sqlTimeouts })))(
    "requires a timeout object: $sqlTimeouts",
    ({ sqlTimeouts }) =>
      expect(parseAuthorityTransactionSpec({ ...spec(), sqlTimeouts })).toEqual(invalid),
  );

  it.each(invalidTimeoutRows)("rejects invalid $field: $value", ({ field, value }) => {
    expect(parseAuthorityTransactionSpec(withTimeout(field, value))).toEqual(invalid);
  });

  it.each([
    [2_000, 1_000, 3_000],
    [1_000, 3_000, 2_000],
    [3, 2, 1],
  ])("requires lock <= statement <= idle: %j", (lockMs, statementMs, idleMs) => {
    expect(
      parseAuthorityTransactionSpec({ ...spec(), sqlTimeouts: { lockMs, statementMs, idleMs } }),
    ).toEqual(invalid);
  });

  it("detaches returned tuples and timeout objects without mutating or freezing caller input", () => {
    const input = spec();
    const before = structuredClone(input);
    const first = parseAuthorityTransactionSpec(input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    Reflect.set(first.value.key, "0", 99);
    Reflect.set(first.value.sqlTimeouts, "lockMs", 1);
    expect(input).toEqual(before);
    for (const value of [input, input.key, input.sqlTimeouts])
      expect(Object.isFrozen(value)).toBe(false);
    expect(parseAuthorityTransactionSpec(input)).toEqual({ ok: true, value: before });
  });

  it("keeps an earlier accepted specification independent of later caller changes", () => {
    const input = spec();
    const before = structuredClone(input);
    const result = parseAuthorityTransactionSpec(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    input.key[0] = MIN_INT32;
    input.sqlTimeouts.lockMs = 1;
    expect(result.value).toEqual(before);
    expect(parseAuthorityTransactionSpec(input)).toEqual({ ok: true, value: input });
  });
});
