import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { compact, runPages } from "./eventSyncBoundsFixture";

const MAX_CURSOR_BYTES = 64 * 1024;
const MAX_PAGE_TOKEN_BYTES = 1024 * 1024;
const network = vi.fn<typeof fetch>();
beforeEach(() => {
  network.mockClear();
  network.mockRejectedValue(
    new AppError(ERROR_IDS.DB_INVARIANT, "unexpected external cursor request"),
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

function cursor(bytes: number, prefix = "opaque+/="): string {
  const rest = bytes - new TextEncoder().encode(prefix).byteLength;
  return prefix + "é".repeat(Math.floor(rest / 2)) + "x".repeat(rest % 2);
}

it("bounds each returned page cursor in UTF8 bytes and preserves its exact accepted value", async () => {
  const exact = cursor(MAX_CURSOR_BYTES);
  const accepted = await runPages((page) =>
    page === 0 ? { nextPageToken: exact } : { nextSyncToken: "complete" },
  );
  expect(compact(accepted.result)).toMatchObject({ ok: true, count: 0, cursor: "complete" });
  expect(new URL(accepted.urls[1] ?? "").searchParams.get("pageToken")).toBe(exact);
  const overflow = await runPages((page) =>
    page === 0
      ? { nextPageToken: cursor(MAX_CURSOR_BYTES + 1) }
      : { nextSyncToken: "must-not-publish" },
  );
  expect(compact(overflow.result)).toEqual({
    ok: false,
    kind: "invalid_response",
    hasValue: false,
  });
  expect(overflow.urls).toHaveLength(1);
});

it("bounds the final sync cursor in UTF8 bytes without truncation or normalization", async () => {
  const exact = cursor(MAX_CURSOR_BYTES);
  const accepted = await runPages(() => ({ nextSyncToken: exact }));
  expect(accepted.result).toEqual({ ok: true, value: { events: [], syncToken: exact } });
  const overflow = await runPages(() => ({ nextSyncToken: cursor(MAX_CURSOR_BYTES + 1) }));
  expect(compact(overflow.result)).toEqual({
    ok: false,
    kind: "invalid_response",
    hasValue: false,
  });
});

it("bounds retained distinct page cursors even when every event page is empty", async () => {
  const tokenCount = MAX_PAGE_TOKEN_BYTES / MAX_CURSOR_BYTES;
  const pages = (overflow: boolean) => (page: number) =>
    page < tokenCount
      ? { nextPageToken: cursor(MAX_CURSOR_BYTES, `cursor_${page}_`) }
      : overflow && page === tokenCount
        ? { nextPageToken: "x" }
        : { nextSyncToken: "empty-complete" };
  const accepted = await runPages(pages(false));
  expect(compact(accepted.result)).toMatchObject({ ok: true, count: 0, cursor: "empty-complete" });
  expect(accepted.urls).toHaveLength(tokenCount + 1);
  const overflow = await runPages(pages(true));
  expect(compact(overflow.result)).toEqual({
    ok: false,
    kind: "invalid_response",
    hasValue: false,
  });
  expect(overflow.urls).toHaveLength(tokenCount + 1);
});

it("rejects PostgreSQL-unsafe returned page and final cursors while preserving valid Unicode", async () => {
  const exact = "تقویم 😀 é e\u0301 +/=";
  const accepted = await runPages((page) =>
    page === 0 ? { nextPageToken: exact } : { nextSyncToken: exact },
  );
  expect(accepted.result).toEqual({ ok: true, value: { events: [], syncToken: exact } });
  expect(new URL(accepted.urls[1] ?? "").searchParams.get("pageToken")).toBe(exact);
  for (const unsafe of ["nul\u0000cursor", "high\ud800", "low\udfff"]) {
    const page = await runPages((index) =>
      index === 0 ? { nextPageToken: unsafe } : { nextSyncToken: "must-not-publish" },
    );
    expect(compact(page.result)).toEqual({ ok: false, kind: "invalid_response", hasValue: false });
    expect(page.urls).toHaveLength(1);
    const final = await runPages(() => ({ nextSyncToken: unsafe }));
    expect(compact(final.result)).toEqual({ ok: false, kind: "invalid_response", hasValue: false });
  }
});
