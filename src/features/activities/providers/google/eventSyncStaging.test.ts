import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { err, ok } from "@/types/result";
import {
  deferred,
  input,
  loadVisitor,
  recordingStage,
  response,
  type StagedPage,
  syntheticPages,
  waitGate,
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

it("awaits each stage before fetching again and withholds completion until terminal staging", async () => {
  const visit = await loadVisitor();
  const source = syntheticPages([
    { accessRole: "writer", nextPageToken: "next" },
    { accessRole: "writer", nextSyncToken: "complete" },
  ]);
  const entered = [deferred<void>(), deferred<void>()] as const;
  const release = [deferred<void>(), deferred<void>()] as const;
  const pages: StagedPage[] = [];
  const request = input();
  const running = visit(source.client, request, async (page, signal) => {
    expect(signal).toBe(request.signal);
    pages.push(page);
    const gate = entered[page.ordinal];
    const wait = release[page.ordinal];
    if (gate === undefined || wait === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "unexpected stage ordinal");
    gate.resolve();
    await waitGate(wait.promise, signal);
    return ok(undefined);
  });
  let settled = false;
  const observed = running.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  try {
    await waitGate(entered[0].promise, request.signal);
    expect(source.urls).toHaveLength(1);
    expect(settled).toBe(false);
    release[0].resolve();
    await waitGate(entered[1].promise, request.signal);
    expect(source.urls).toHaveLength(2);
    expect(settled).toBe(false);
    expect(pages).toEqual([
      { ordinal: 0, accessRole: "writer", items: [] },
      { ordinal: 1, accessRole: "writer", items: [] },
    ]);
    release[1].resolve();
    expect(await running).toMatchObject({ ok: true, value: { syncToken: "complete" } });
  } finally {
    for (const gate of release) gate.resolve();
    await running.catch(() => undefined);
    await observed;
  }
});

it("propagates stage Result errors unchanged and makes no later request", async () => {
  const visit = await loadVisitor();
  for (const kind of ["storage", "conflict"] as const)
    for (const failAt of [0, 1]) {
      const error = { kind };
      const source = syntheticPages([
        { accessRole: "writer", nextPageToken: "next" },
        { accessRole: "writer", nextSyncToken: "unsafe" },
      ]);
      const result = await visit(source.client, input(), (page) =>
        Promise.resolve(page.ordinal === failAt ? err(error) : ok(undefined)),
      );
      expect(result).toEqual({ ok: false, error });
      if (!result.ok) expect(result.error).toBe(error);
      expect(source.urls).toHaveLength(failAt + 1);
    }
});

it("preserves later provider failures including expired sync without a completion cursor", async () => {
  const visit = await loadVisitor();
  for (const [status, expected] of [
    [410, { kind: "sync_expired", status: 410 }],
    [429, { kind: "rate_limited", status: 429, retryAfterSeconds: 15 }],
    [503, { kind: "provider_unavailable", status: 503, retryAfterSeconds: 15 }],
  ] as const) {
    const source = syntheticPages([
      { accessRole: "writer", items: [{ id: "private-stage" }], nextPageToken: "later" },
      response({ error: { code: status } }, status, status === 410 ? {} : { "Retry-After": "15" }),
    ]);
    const sink = recordingStage();
    expect(await visit(source.client, input(), sink.stage)).toEqual({ ok: false, error: expected });
    expect(sink.pages).toHaveLength(1);
    expect(source.urls).toHaveLength(2);
  }
});
