import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  input,
  jsonBytes,
  loadVisitor,
  readableRoles,
  recordingStage,
  syntheticPages,
} from "./eventSyncPagesFixture";

const network = vi.fn<typeof fetch>();
beforeEach(() => {
  network.mockClear();
  network.mockRejectedValue(
    new AppError(ERROR_IDS.DB_INVARIANT, "unexpected external page request"),
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

it("preserves page accessRole while ordinary role-less reads remain compatible", async () => {
  const missing = syntheticPages([{ items: [], nextSyncToken: "ordinary" }]);
  expect(await missing.client.eventsList(input())).toEqual({
    ok: true,
    value: { items: [], nextSyncToken: "ordinary" },
  });
  for (const accessRole of [...readableRoles, "futureRole"]) {
    const source = syntheticPages([{ items: [], accessRole, nextSyncToken: "role" }]);
    expect(await source.client.eventsList(input())).toEqual({
      ok: true,
      value: { items: [], accessRole, nextSyncToken: "role" },
    });
  }
});

it("visits every matching readable-role page and returns only final completion metadata", async () => {
  const visit = await loadVisitor();
  const event = { id: "one", summary: "تقویم / Kalender" };
  for (const role of readableRoles) {
    const source = syntheticPages([
      { accessRole: role, items: [event], nextPageToken: "next" },
      { accessRole: role, nextSyncToken: "complete" },
    ]);
    const sink = recordingStage();
    expect(await visit(source.client, input({ expectedAccessRole: role }), sink.stage)).toEqual({
      ok: true,
      value: {
        accessRole: role,
        syncToken: "complete",
        pages: 2,
        events: 1,
        bytes: jsonBytes(event),
      },
    });
    expect(sink.pages).toEqual([
      { ordinal: 0, accessRole: role, items: [event] },
      { ordinal: 1, accessRole: role, items: [] },
    ]);
  }
});

it("rejects missing unknown unreadable and mismatching first-page authority before staging", async () => {
  const visit = await loadVisitor();
  for (const role of [undefined, "futureRole", "none", "freeBusyReader", "reader"]) {
    for (const items of [[], [{ id: "private" }]]) {
      const source = syntheticPages([
        { ...(role === undefined ? {} : { accessRole: role }), items, nextSyncToken: "unsafe" },
      ]);
      const sink = recordingStage();
      expect(await visit(source.client, input(), sink.stage)).toEqual({
        ok: false,
        error: { kind: "catalog_changed" },
      });
      expect(sink.pages).toEqual([]);
      expect(source.urls).toHaveLength(1);
    }
  }
});

it("rejects later authority changes without staging that page or releasing its cursor", async () => {
  const visit = await loadVisitor();
  for (const role of [undefined, "futureRole", "none", "freeBusyReader", "reader", "owner"]) {
    for (const items of [[], [{ id: "unsafe" }]]) {
      const source = syntheticPages([
        { accessRole: "writer", items: [{ id: "private-stage" }], nextPageToken: "next" },
        { ...(role === undefined ? {} : { accessRole: role }), items, nextSyncToken: "unsafe" },
      ]);
      const sink = recordingStage();
      expect(await visit(source.client, input(), sink.stage)).toEqual({
        ok: false,
        error: { kind: "catalog_changed" },
      });
      expect(sink.pages).toEqual([
        { ordinal: 0, accessRole: "writer", items: [{ id: "private-stage" }] },
      ]);
      expect(source.urls).toHaveLength(2);
    }
  }
});

it("preserves the original full or incremental query while advancing only pageToken", async () => {
  const visit = await loadVisitor();
  for (const syncToken of [undefined, "original+/= تقویم"]) {
    const source = syntheticPages([
      { accessRole: "writer", nextPageToken: "next+/=" },
      { accessRole: "writer", nextSyncToken: "complete+/=" },
    ]);
    const request = input({ syncToken });
    expect((await visit(source.client, request, recordingStage().stage)).ok).toBe(true);
    for (const [index, raw] of source.urls.entries()) {
      const url = new URL(raw);
      expect(url.pathname).toContain("team%2Fa%3Fb%40example.invalid");
      expect(url.searchParams.get("syncToken")).toBe(syncToken ?? null);
      expect(url.searchParams.get("pageToken")).toBe(index === 0 ? null : "next+/=");
      expect(url.searchParams.get("showDeleted")).toBe("true");
      expect(url.searchParams.get("singleEvents")).toBe("false");
      expect(url.searchParams.get("maxResults")).toBe("2500");
      for (const forbidden of [
        "timeMin",
        "timeMax",
        "updatedMin",
        "q",
        "orderBy",
        "iCalUID",
        "privateExtendedProperty",
        "sharedExtendedProperty",
      ])
        expect(url.searchParams.has(forbidden)).toBe(false);
    }
    expect(source.signals).toEqual([request.signal, request.signal]);
  }
});
