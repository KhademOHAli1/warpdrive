import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { ok } from "@/types/result";
import {
  input,
  invalidPages,
  jsonBytes,
  loadVisitor,
  pageSignal,
  rawRecurrenceEvents,
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

it("validates the whole page and its cursor before staging any offending page", async () => {
  const visit = await loadVisitor();
  for (const scenario of invalidPages()) {
    const source = syntheticPages(scenario.pages);
    const sink = recordingStage();
    expect(await visit(source.client, input(), sink.stage)).toEqual({
      ok: false,
      error: { kind: "invalid_response" },
    });
    expect(sink.pages).toHaveLength(scenario.staged);
    expect(source.urls).toHaveLength(scenario.pages.length);
  }
});

it("stages raw recurrence moved exceptions sparse cancellations and future fields intact", async () => {
  const visit = await loadVisitor();
  const events = rawRecurrenceEvents();
  const source = syntheticPages([
    { accessRole: "writer", items: events.slice(0, 2), nextPageToken: "next" },
    { accessRole: "writer", items: events.slice(2), nextSyncToken: "complete" },
  ]);
  const sink = recordingStage();
  expect(await visit(source.client, input(), sink.stage)).toEqual({
    ok: true,
    value: {
      accessRole: "writer",
      syncToken: "complete",
      pages: 2,
      events: events.length,
      bytes: events.reduce((total, event) => total + jsonBytes(event), 0),
    },
  });
  expect(sink.pages.flatMap((page) => page.items)).toEqual(events);
});

it("propagates exact abort reasons before fetch after fetch and after staging", async () => {
  const visit = await loadVisitor();
  for (const phase of ["before", "after-fetch", "after-stage", "after-terminal-stage"] as const) {
    const controller = new AbortController();
    const reason = new DOMException(`Cancelled ${phase}`, "AbortError");
    const terminal = phase === "after-terminal-stage";
    const source = syntheticPages([
      terminal
        ? { accessRole: "writer", nextSyncToken: "unsafe" }
        : { accessRole: "writer", nextPageToken: "later" },
    ]);
    let stages = 0;
    if (phase === "before") controller.abort(reason);
    const client = {
      eventsList: async (request: Parameters<typeof source.client.eventsList>[0]) => {
        const result = await source.client.eventsList(request);
        if (phase === "after-fetch") controller.abort(reason);
        return result;
      },
    };
    await expect(
      visit(client, input({ signal: AbortSignal.any([controller.signal, pageSignal()]) }), () => {
        stages += 1;
        controller.abort(reason);
        return Promise.resolve(ok(undefined));
      }),
    ).rejects.toBe(reason);
    expect(source.urls).toHaveLength(phase === "before" ? 0 : 1);
    expect(stages).toBe(phase === "after-stage" || terminal ? 1 : 0);
  }
});
