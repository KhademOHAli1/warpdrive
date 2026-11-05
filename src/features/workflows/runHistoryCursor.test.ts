import { describe, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import {
  readRunHistoryCursor,
  runHistoryCursorFingerprint,
  writeRunHistoryCursor,
} from "./runHistoryCursor";

const id = "cb001f5a-b8a4-49fc-88d9-eccb94c9a773";
const context = {
  actorId: "64d7f11d-5838-4fe2-8a11-3c6116bf715f",
  scope: "owner",
  workflowId: id,
  ownerId: "64d7f11d-5838-4fe2-8a11-3c6116bf715f",
  status: "all",
  mode: "all",
  size: 50,
} as const;
const fingerprint = runHistoryCursorFingerprint(context);
const key = { createdAt: "2026-11-04T12:34:56.123456Z", id };
const payload = { version: 1, kind: "workflow-runs", fingerprint, key };
function encode(raw: unknown) {
  return Buffer.from(JSON.stringify(raw)).toString("base64url");
}
const invalid = { ok: false, error: ERROR_IDS.WORKFLOW_INVALID };

describe("run-history exact timestamp cursor contract", () => {
  it.each([
    "2026-11-04T12:34:56.123001Z",
    "2026-11-04T12:34:56.123456Z",
    "2026-11-04T12:34:56.123999Z",
    "2024-02-29T00:00:00.000001Z",
  ])("round-trips all six digits of %s without a Date conversion", (createdAt) => {
    const source = Object.freeze({ ...key, createdAt });
    const cursor = writeRunHistoryCursor(fingerprint, source);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor.length).toBeLessThanOrEqual(4096);
    expect(readRunHistoryCursor(cursor, fingerprint)).toEqual({
      ok: true,
      value: { ...payload, key: source },
    });
    expect(source.createdAt).toBe(createdAt);
  });

  it("keeps different PostgreSQL microseconds distinct within the same display millisecond", () => {
    const first = { ...key, createdAt: "2026-11-04T12:34:56.123001Z" };
    const second = { ...key, createdAt: "2026-11-04T12:34:56.123999Z" };
    expect(new Date(first.createdAt).getTime()).toBe(new Date(second.createdAt).getTime());
    expect(writeRunHistoryCursor(fingerprint, first)).not.toBe(
      writeRunHistoryCursor(fingerprint, second),
    );
  });

  it.each([
    "2026-11-04T12:34:56.123Z",
    "2026-11-04T12:34:56.1234567Z",
    "2026-11-04T12:34:56.123456+00:00",
    "2026-11-04T12:34:56.123456",
    "2026-02-30T12:34:56.123456Z",
    "2025-02-29T12:34:56.123456Z",
    "0000-01-01T00:00:00.000000Z",
    "2026-13-04T12:34:56.123456Z",
    "2026-11-04T25:34:56.123456Z",
    "Infinity",
  ])("rejects malformed exact timestamp %s", (createdAt) => {
    expect(
      readRunHistoryCursor(encode({ ...payload, key: { ...key, createdAt } }), fingerprint),
    ).toEqual(invalid);
  });

  it.each([
    { ...payload, version: 2 },
    { ...payload, version: "1" },
    { ...payload, kind: "workflows" },
    { ...payload, extra: true },
    { ...payload, fingerprint: "z".repeat(64) },
    { ...payload, key: { ...key, id: "not-a-uuid" } },
    { ...payload, key: { ...key, extra: "unreviewed" } },
    { ...payload, key: { id } },
    { ...payload, key: null },
    { key },
    null,
    [],
  ])("rejects an unknown or incomplete cursor envelope %j", (raw) => {
    expect(readRunHistoryCursor(encode(raw), fingerprint)).toEqual(invalid);
  });

  it.each([
    "",
    "=",
    "AAA=",
    "AA+_",
    " ",
    "A",
    "A".repeat(4097),
    Buffer.from("not json").toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url") + "=",
  ])("rejects noncanonical, malformed or oversized encoding %j", (raw) => {
    expect(readRunHistoryCursor(raw, fingerprint)).toEqual(invalid);
  });

  it.each([
    { actorId: id },
    { scope: "admin" },
    { workflowId: context.actorId },
    { ownerId: id },
    { status: "failed" },
    { mode: "simulation" },
    { size: 49 },
  ])("binds continuation to changed current query context %j", (changed) => {
    const cursor = writeRunHistoryCursor(fingerprint, key);
    const different = runHistoryCursorFingerprint({ ...context, ...changed });
    expect(different).not.toBe(fingerprint);
    expect(readRunHistoryCursor(cursor, different)).toEqual(invalid);
  });

  it("does not mutate the fingerprint context or turn its hash into an authority token", () => {
    const source = Object.freeze({ ...context });
    expect(runHistoryCursorFingerprint(source)).toBe(fingerprint);
    const forgedKey = { ...key, id: context.actorId };
    // Reauthorization and workflow scope belong to every service request. This
    // public consistency hash intentionally is not a secret or a signature.
    expect(readRunHistoryCursor(encode({ ...payload, key: forgedKey }), fingerprint)).toEqual({
      ok: true,
      value: { ...payload, key: forgedKey },
    });
    expect(source).toEqual(context);
  });

  it("treats an invalid database-projected writer key as an invariant failure", () => {
    expect(() => writeRunHistoryCursor(fingerprint, { ...key, createdAt: "Infinity" })).toThrow(
      expect.objectContaining({ id: ERROR_IDS.DB_INVARIANT }),
    );
  });
});
