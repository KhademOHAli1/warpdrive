import { describe, expect, it } from "vitest";
import {
  decodeProjectListCursor,
  encodeProjectListCursor,
  projectListCursorSchema,
} from "./projectListCursor";
import { projectListFilterKey, projectListFilterSchema } from "./projectListInput";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "11111111-1111-4111-8111-111111111112";
const KEY = "filters:v1";
const CREATED = "2024-01-01T00:00:00.123456Z";
const CURSOR = { schemaVersion: 1 as const, createdAt: CREATED, id: ID, filterKey: KEY };
const WIRE =
  '{"schemaVersion":1,"createdAt":"2024-01-01T00:00:00.123456Z","id":"11111111-1111-4111-8111-111111111111","filterKey":"filters:v1"}';
const ENCODED = Buffer.from(WIRE, "utf8").toString("base64url");
const INVALID = { ok: false, error: "invalid_project_list_input" };

describe("project list cursor wire contract", () => {
  it("emits the explicit versioned wire fields and decodes an independently specified JSON value", () => {
    expect(Buffer.from(encodeProjectListCursor(CURSOR), "base64url").toString("utf8")).toBe(WIRE);
    expect(decodeProjectListCursor(ENCODED, KEY)).toEqual({ ok: true, value: CURSOR });
  });

  it.each(["2024-01-01T00:00:00.000001Z", "2024-01-01T00:00:00.000002Z"])(
    "preserves all six microsecond digits: %s",
    (createdAt) => {
      const encoded = encodeProjectListCursor({ ...CURSOR, createdAt });
      expect(decodeProjectListCursor(encoded, KEY)).toEqual({
        ok: true,
        value: { ...CURSOR, createdAt },
      });
      expect(Buffer.from(encoded, "base64url").toString("utf8")).toContain(createdAt);
    },
  );

  it("preserves distinct UUID tie keys at an identical timestamp (no SQL paging claim)", () => {
    const first = encodeProjectListCursor(CURSOR);
    const second = encodeProjectListCursor({ ...CURSOR, id: OTHER_ID });
    expect(first).not.toBe(second);
    expect(decodeProjectListCursor(first, KEY)).toEqual({ ok: true, value: CURSOR });
    expect(decodeProjectListCursor(second, KEY)).toEqual({
      ok: true,
      value: { ...CURSOR, id: OTHER_ID },
    });
  });

  it.each([
    "0001-01-01T00:00:00.000000Z",
    "9999-12-31T23:59:59.999999Z",
    "2000-02-29T12:34:56.123456Z",
    "2024-02-29T00:00:00.000000Z",
  ])("accepts a real canonical UTC calendar instant: %s", (createdAt) => {
    expect(projectListCursorSchema.safeParse({ ...CURSOR, createdAt }).success).toBe(true);
  });

  it.each([
    "0000-01-01T00:00:00.000000Z",
    "10000-01-01T00:00:00.000000Z",
    "1900-02-29T00:00:00.000000Z",
    "2023-02-29T00:00:00.000000Z",
    "2024-04-31T00:00:00.000000Z",
    "2024-13-01T00:00:00.000000Z",
    "2024-01-01T24:00:00.000000Z",
    "2024-01-01T00:00:60.000000Z",
    "2024-01-01T00:00:00.12345Z",
    "2024-01-01T00:00:00.1234567Z",
    "2024-01-01T00:00:00Z",
    "2024-01-01T00:00:00.123456z",
    "2024-01-01T00:00:00.123456+00:00",
    "2024-01-01 00:00:00.123456Z",
    "2024-01-01T00:00:00.123456Z\n",
  ])("rejects a noncanonical or impossible timestamp: %j", (createdAt) => {
    const encoded = Buffer.from(JSON.stringify({ ...CURSOR, createdAt })).toString("base64url");
    expect(decodeProjectListCursor(encoded, KEY)).toEqual(INVALID);
  });

  it.each([undefined, 0, 2, "1"])("requires cursor version 1, received %j", (schemaVersion) => {
    const encoded = Buffer.from(JSON.stringify({ ...CURSOR, schemaVersion })).toString("base64url");
    expect(decodeProjectListCursor(encoded, KEY)).toEqual(INVALID);
  });

  it.each(["actorUserId", "sessionId", "authorityGeneration", "permissionFlags", "canRead"])(
    "rejects an injected authority field: %s",
    (field) => {
      const encoded = Buffer.from(JSON.stringify({ ...CURSOR, [field]: ID })).toString("base64url");
      expect(decodeProjectListCursor(encoded, KEY)).toEqual(INVALID);
    },
  );

  it.each(["not-a-uuid", "11111111111141118111111111111111"])(
    "rejects a malformed UUID: %s",
    (id) => {
      const encoded = Buffer.from(JSON.stringify({ ...CURSOR, id })).toString("base64url");
      expect(decodeProjectListCursor(encoded, KEY)).toEqual(INVALID);
    },
  );

  it("normalizes an equivalent uppercase UUID through the shared canonical UUID boundary", () => {
    const id = "ABCDEFAB-1234-4234-8234-123456789ABC";
    const encoded = Buffer.from(JSON.stringify({ ...CURSOR, id })).toString("base64url");
    expect(decodeProjectListCursor(encoded, KEY)).toEqual({
      ok: true,
      value: { ...CURSOR, id: "abcdefab-1234-4234-8234-123456789abc" },
    });
  });

  it.each([
    "",
    "*",
    `${ENCODED}=`,
    ` ${ENCODED}`,
    `${ENCODED}\n`,
    "A".repeat(2_048),
    "A".repeat(2_049),
  ])("rejects an invalid, padded or overlong base64url wire value", (encoded) =>
    expect(decodeProjectListCursor(encoded, KEY)).toEqual(INVALID),
  );

  it("rejects nonzero unused base64 bits even when they decode to the same valid JSON bytes", () => {
    const json = WIRE + " ".repeat(((1 - (Buffer.byteLength(WIRE) % 3) + 3) % 3) + 3);
    const canonical = Buffer.from(json).toString("base64url");
    const alias = `${canonical.slice(0, -1)}B`;
    expect(canonical.endsWith("A")).toBe(true);
    expect(Buffer.from(alias, "base64url")).toEqual(Buffer.from(json));
    expect(decodeProjectListCursor(canonical, KEY)).toEqual({ ok: true, value: CURSOR });
    expect(decodeProjectListCursor(alias, KEY)).toEqual(INVALID);
  });

  it.each(["{", "null", "[]", '"cursor"'])(
    "rejects invalid JSON or a nonobject payload: %s",
    (json) => {
      expect(decodeProjectListCursor(Buffer.from(json).toString("base64url"), KEY)).toEqual(
        INVALID,
      );
    },
  );

  it("rejects malformed UTF-8 inside filterKey despite replacement-decoded JSON being valid", () => {
    const bytes = Buffer.concat([
      Buffer.from(
        '{"schemaVersion":1,"createdAt":"2024-01-01T00:00:00.123456Z","id":"11111111-1111-4111-8111-111111111111","filterKey":"',
      ),
      Buffer.from([0xff]),
      Buffer.from('"}'),
    ]);
    const replacementDecoded: unknown = JSON.parse(bytes.toString("utf8"));
    expect(replacementDecoded).toEqual({ ...CURSOR, filterKey: "\uFFFD" });
    expect(decodeProjectListCursor(bytes.toString("base64url"), "\uFFFD")).toEqual(INVALID);
  });

  it("retains a valid multilingual UTF-8 filter key within all bounds", () => {
    const filterKey = "فیلتر ä";
    const encoded = encodeProjectListCursor({ ...CURSOR, filterKey });
    expect(decodeProjectListCursor(encoded, filterKey)).toEqual({
      ok: true,
      value: { ...CURSOR, filterKey },
    });
  });

  it("accepts exactly 1024 decoded bytes and rejects 1025, within the encoded-length bound", () => {
    const atLimit = WIRE + " ".repeat(1_024 - Buffer.byteLength(WIRE));
    expect(Buffer.byteLength(atLimit)).toBe(1_024);
    expect(decodeProjectListCursor(Buffer.from(atLimit).toString("base64url"), KEY)).toEqual({
      ok: true,
      value: CURSOR,
    });
    const overLimit = Buffer.from(`${atLimit} `).toString("base64url");
    expect(overLimit.length).toBeLessThanOrEqual(2_048);
    expect(decodeProjectListCursor(overLimit, KEY)).toEqual(INVALID);
  });

  it.each(["", "x".repeat(769)])("rejects an empty or overlong filter key", (filterKey) => {
    const encoded = Buffer.from(JSON.stringify({ ...CURSOR, filterKey })).toString("base64url");
    expect(decodeProjectListCursor(encoded, filterKey)).toEqual(INVALID);
  });

  it("accepts the 768-character key boundary and applies the byte ceiling to valid multibyte UTF-8", () => {
    const filterKey = "x".repeat(768);
    expect(
      decodeProjectListCursor(encodeProjectListCursor({ ...CURSOR, filterKey }), filterKey),
    ).toEqual({ ok: true, value: { ...CURSOR, filterKey } });
    const unicodeKey = "ä".repeat(500);
    expect(projectListCursorSchema.safeParse({ ...CURSOR, filterKey: unicodeKey }).success).toBe(
      true,
    );
    const bytes = Buffer.from(JSON.stringify({ ...CURSOR, filterKey: unicodeKey }));
    expect(bytes.length).toBeGreaterThan(1_024);
    expect(bytes.toString("base64url").length).toBeLessThanOrEqual(2_048);
    expect(decodeProjectListCursor(bytes.toString("base64url"), unicodeKey)).toEqual(INVALID);
    expect(decodeProjectListCursor(ENCODED, `${KEY} `)).toEqual(INVALID);
  });
});

describe("cursor binding to normalized project-list filters", () => {
  const filter = projectListFilterSchema.parse({ schemaVersion: 1 });
  const key =
    '{"schemaVersion":1,"states":["planned","active","on-hold"],"ownerUserId":null,"anchor":null}';

  it("uses the expected filter shape and accepts equivalent state ordering", () => {
    const reordered = projectListFilterSchema.parse({
      schemaVersion: 1,
      states: ["on-hold", "planned", "active"],
    });
    expect(projectListFilterKey(filter)).toBe(key);
    expect(projectListFilterKey(reordered)).toBe(key);
    const encoded = encodeProjectListCursor({ ...CURSOR, filterKey: key });
    expect(decodeProjectListCursor(encoded, projectListFilterKey(reordered))).toEqual({
      ok: true,
      value: { ...CURSOR, filterKey: key },
    });
  });

  it.each([
    { schemaVersion: 1, states: ["planned"] },
    { schemaVersion: 1, ownerUserId: ID },
    { schemaVersion: 1, anchor: { kind: "deal", id: ID } },
  ])("rejects continuation after a state, owner or anchor change: %j", (input) => {
    const encoded = encodeProjectListCursor({ ...CURSOR, filterKey: key });
    const changed = projectListFilterKey(projectListFilterSchema.parse(input));
    expect(decodeProjectListCursor(encoded, changed)).toEqual(INVALID);
  });

  it.each([
    { kind: "person", id: ID },
    { kind: "organization", id: ID },
    { kind: "deal", id: OTHER_ID },
  ])("binds both anchor kind and identity: %j", (anchor) => {
    const original = projectListFilterSchema.parse({
      schemaVersion: 1,
      anchor: { kind: "deal", id: ID },
    });
    const changed = projectListFilterSchema.parse({ schemaVersion: 1, anchor });
    const encoded = encodeProjectListCursor({
      ...CURSOR,
      filterKey: projectListFilterKey(original),
    });
    expect(decodeProjectListCursor(encoded, projectListFilterKey(changed))).toEqual(INVALID);
  });
});
