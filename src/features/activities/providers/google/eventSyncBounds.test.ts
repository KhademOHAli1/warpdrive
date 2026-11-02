import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  createGoogleCalendarClient,
  type GoogleCalendarClient,
} from "@/features/activities/providers/google/client";
import { collectGoogleEventSync } from "@/features/activities/providers/google/sync";
import {
  compact,
  countedPages,
  grant,
  MAX_EVENTS,
  MAX_PAGES,
  runPages,
  syntheticPages,
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

it("accepts a terminal cursor on page 1000 and rejects a continuation beyond the page budget", async () => {
  const pages = (total: number) => (index: number) =>
    index + 1 === total
      ? { items: [{ id: "last_page_event" }], nextSyncToken: "page-limit-complete" }
      : { items: [], nextPageToken: `page_${index + 1}` };
  const boundary = await runPages(pages(MAX_PAGES));
  expect(compact(boundary.result)).toMatchObject({
    ok: true,
    count: 1,
    cursor: "page-limit-complete",
  });
  expect(boundary.urls).toHaveLength(MAX_PAGES);
  const overflow = await runPages(pages(MAX_PAGES + 1));
  expect(compact(overflow.result)).toEqual({
    ok: false,
    kind: "invalid_response",
    hasValue: false,
  });
  expect(overflow.urls).toHaveLength(MAX_PAGES);
});

it("accepts 50000 events and rejects the 50001st event across otherwise valid pages", async () => {
  expect(compact((await runPages(countedPages(MAX_EVENTS))).result)).toMatchObject({
    ok: true,
    count: MAX_EVENTS,
  });
  const overflow = await runPages(countedPages(MAX_EVENTS + 1));
  expect(compact(overflow.result)).toEqual({
    ok: false,
    kind: "invalid_response",
    hasValue: false,
  });
  expect(overflow.urls).toHaveLength(21);
});

it("rejects duplicate opaque event IDs within a page without case-folding or Unicode normalization", async () => {
  const distinct = ["Opaque_ID", "opaque_id", "é", "e\u0301"].map((id) => ({ id }));
  expect(
    compact(
      (await runPages(() => ({ items: distinct, nextSyncToken: "distinct-complete" }))).result,
    ),
  ).toMatchObject({ ok: true, count: 4 });
  const duplicate = {
    items: [
      { id: "same_id", etag: '"one"' },
      { id: "same_id", etag: '"two"' },
    ],
    nextSyncToken: "must-not-publish",
  };
  expect(compact((await runPages(() => duplicate)).result)).toEqual({
    ok: false,
    kind: "invalid_response",
    hasValue: false,
  });
});

it("rejects duplicate event IDs across pages even when the later entry is a cancellation", async () => {
  const collected = await runPages((page) =>
    page === 0
      ? {
          items: [{ id: "series_20300320T090000Z", status: "confirmed" }],
          nextPageToken: "cancelled",
        }
      : {
          items: [{ id: "series_20300320T090000Z", status: "cancelled" }],
          nextSyncToken: "must-not-publish",
        },
  );
  expect(compact(collected.result)).toEqual({
    ok: false,
    kind: "invalid_response",
    hasValue: false,
  });
  expect(collected.urls).toHaveLength(2);
});

it("preserves recurrence masters, sparse cancelled exceptions and unknown fields with only a complete final cursor", async () => {
  const master = {
    id: "series_opaque",
    etag: '"master-etag"',
    summary: "Recurring provider event",
    start: { dateTime: "2030-03-20T09:00:00+03:30", timeZone: "Asia/Tehran" },
    end: { dateTime: "2030-03-20T10:00:00+03:30", timeZone: "Asia/Tehran" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE", "EXDATE;TZID=Asia/Tehran:20300327T090000"],
    futureProviderField: { preserve: ["opaque", true] },
  };
  const exception = {
    id: "series_20300320T053000Z",
    status: "cancelled",
    recurringEventId: master.id,
    originalStartTime: { dateTime: "2030-03-20T09:00:00+03:30", timeZone: "Asia/Tehran" },
  };
  const allDay = {
    id: "all_day_series",
    start: { date: "2030-03-20" },
    end: { date: "2030-03-21" },
    recurrence: ["RRULE:FREQ=DAILY;COUNT=3"],
  };
  const allDayException = {
    id: "all_day_series_20300321",
    status: "cancelled",
    recurringEventId: allDay.id,
    originalStartTime: { date: "2030-03-21" },
  };
  const sparse = { id: "sparse_deleted", status: "cancelled" };
  for (const syncToken of [undefined, "old+/="]) {
    const collected = await runPages(
      (page) =>
        page === 0
          ? { items: [master, allDay], nextPageToken: "page+/=" }
          : { items: [exception, allDayException, sparse], nextSyncToken: "complete+/=" },
      { syncToken },
    );
    expect(collected.result).toEqual({
      ok: true,
      value: {
        events: [master, allDay, exception, allDayException, sparse],
        syncToken: "complete+/=",
      },
    });
    for (const raw of collected.urls) {
      const url = new URL(raw);
      expect(url.searchParams.get("showDeleted")).toBe("true");
      expect(url.searchParams.get("singleEvents")).toBe("false");
      expect(url.searchParams.get("syncToken")).toBe(syncToken ?? null);
      expect(url.searchParams.has("timeMin")).toBe(false);
      expect(url.pathname).toContain("team%2Fa%3Fb%40example.invalid");
    }
  }
});

it("propagates an already-aborted signal before any event provider request", async () => {
  const controller = new AbortController();
  const reason = new DOMException("Event sync cancelled before request", "AbortError");
  controller.abort(reason);
  const source = syntheticPages(() => ({ nextSyncToken: "must-not-publish" }));
  await expect(
    collectGoogleEventSync(createGoogleCalendarClient(grant, source.transport), {
      calendarId: "primary",
      signal: controller.signal,
    }),
  ).rejects.toBe(reason);
  expect(source.urls).toHaveLength(0);
});

it("propagates abort after awaiting a later page without returning partial events or its cursor", async () => {
  const controller = new AbortController();
  const reason = new DOMException("Event sync cancelled after page", "AbortError");
  const source = syntheticPages((page) =>
    page === 0
      ? { items: [{ id: "partial" }], nextPageToken: "later" }
      : { items: [{ id: "never-published" }], nextSyncToken: "must-not-publish" },
  );
  const base = createGoogleCalendarClient(grant, source.transport);
  const client: GoogleCalendarClient = {
    ...base,
    async eventsList(input) {
      const result = await base.eventsList(input);
      if (input.pageToken === "later") controller.abort(reason);
      return result;
    },
  };
  await expect(
    collectGoogleEventSync(client, { calendarId: "primary", signal: controller.signal }),
  ).rejects.toBe(reason);
  expect(source.urls).toHaveLength(2);
});
