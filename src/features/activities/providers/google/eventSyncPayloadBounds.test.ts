import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  aggregateOutcome,
  compact,
  depthEvent,
  jsonBytes,
  MAX_DEPTH,
  MAX_EVENT_BYTES,
  MAX_TOTAL_BYTES,
  runPages,
  sizedEvent,
} from "./eventSyncBoundsFixture";

const network = vi.fn<typeof fetch>();
beforeEach(() => {
  network.mockClear();
  network.mockRejectedValue(
    new AppError(ERROR_IDS.DB_INVARIANT, "unexpected external event request"),
  );
  vi.stubGlobal("fetch", network);
});
afterEach(() => {
  try {
    expect(network).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("measures the one-MiB raw event budget in UTF8 bytes and accepts its exact boundary", async () => {
  const boundary = sizedEvent("utf8_boundary", MAX_EVENT_BYTES, true);
  const overflow = sizedEvent("utf8_overflow", MAX_EVENT_BYTES + 1, true);
  expect(jsonBytes(boundary)).toBe(MAX_EVENT_BYTES);
  expect(jsonBytes(overflow)).toBe(MAX_EVENT_BYTES + 1);
  expect(boundary.opaquePayload.length).toBeLessThan(MAX_EVENT_BYTES);
  expect(
    compact(
      (await runPages(() => ({ items: [boundary], nextSyncToken: "entry-complete" }))).result,
    ),
  ).toMatchObject({ ok: true, count: 1 });
  expect(
    compact(
      (await runPages(() => ({ items: [overflow], nextSyncToken: "must-not-publish" }))).result,
    ),
  ).toEqual({ ok: false, kind: "invalid_response", hasValue: false });
});

it("accepts 32MiB of aggregate entries and rejects another small event without violating the per-event cap", async () => {
  expect(MAX_TOTAL_BYTES).toBe(32 * MAX_EVENT_BYTES);
  expect(await aggregateOutcome(false)).toEqual({
    ok: true,
    count: 32,
    cursor: "aggregate-complete",
    hasValue: true,
    calls: 32,
  });
  expect(await aggregateOutcome(true)).toEqual({
    ok: false,
    kind: "invalid_response",
    hasValue: false,
    calls: 33,
  });
});

it("accepts raw JSON depth 32 and rejects depth 33 in otherwise opaque provider fields", async () => {
  expect(
    compact(
      (await runPages(() => ({ items: [depthEvent(MAX_DEPTH)], nextSyncToken: "depth-complete" })))
        .result,
    ),
  ).toMatchObject({ ok: true, count: 1 });
  expect(
    compact(
      (
        await runPages(() => ({
          items: [depthEvent(MAX_DEPTH + 1)],
          nextSyncToken: "must-not-publish",
        }))
      ).result,
    ),
  ).toEqual({ ok: false, kind: "invalid_response", hasValue: false });
});

it("rejects PostgreSQL-unsafe NUL characters in event values and opaque object keys", async () => {
  expect(
    compact(
      (
        await runPages(() => ({
          items: [{ id: "literal", opaque: "literal\\u0000" }],
          nextSyncToken: "safe",
        }))
      ).result,
    ),
  ).toMatchObject({ ok: true, count: 1 });
  for (const event of [
    { id: "nul_value", summary: "unsafe\u0000value" },
    { id: "nul_key", opaque: { "unsafe\u0000key": true } },
  ]) {
    expect(
      compact(
        (await runPages(() => ({ items: [event], nextSyncToken: "must-not-publish" }))).result,
      ),
    ).toEqual({ ok: false, kind: "invalid_response", hasValue: false });
  }
});

it("rejects lone high and low surrogates in values and keys while preserving valid Unicode", async () => {
  expect(
    compact(
      (
        await runPages(() => ({
          items: [{ id: "unicode", summary: "تقویم 😀", opaque: "é" }],
          nextSyncToken: "safe",
        }))
      ).result,
    ),
  ).toMatchObject({ ok: true, count: 1 });
  for (const event of [
    { id: "high_value", summary: "\ud800" },
    { id: "low_value", opaque: { nested: "\udfff" } },
    { id: "high_key", opaque: { "\ud800": true } },
    { id: "low_key", opaque: { "\udfff": true } },
  ]) {
    expect(
      compact(
        (await runPages(() => ({ items: [event], nextSyncToken: "must-not-publish" }))).result,
      ),
    ).toEqual({ ok: false, kind: "invalid_response", hasValue: false });
  }
});
