import { expect, it, vi } from "vitest";
import { collectGoogleCalendarDiscovery as collect } from "./calendarDiscovery";
import { createGoogleCalendarClient } from "./client";
import type { GoogleCalendarEntry } from "./schemas";

const grant = {
  accessToken: "synthetic-calendar-discovery-token",
  grantedScopes: [
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
};
const signal = () => AbortSignal.timeout(5_000);
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

it("collects a complete full catalog and preserves opaque calendar metadata", async () => {
  const calendar = {
    id: "team/a?b@example.invalid",
    summary: "تیم / Team",
    timeZone: "Asia/Tehran",
    accessRole: "writer",
    hidden: true,
    primary: false,
    colorId: "13",
    conferenceProperties: {
      allowedConferenceSolutionTypes: ["hangoutsMeet", "futureConference"],
      opaqueCapability: "keep",
    },
  };
  const deleted = { id: "deleted@example.invalid", deleted: true };
  const transport = vi
    .fn()
    .mockResolvedValueOnce(response({ items: [calendar], nextPageToken: "opaque+/=" }))
    .mockResolvedValueOnce(response({ items: [], nextPageToken: "last" }))
    .mockResolvedValueOnce(response({ items: [deleted], nextSyncToken: "complete+/=" }));
  expect(await collect(createGoogleCalendarClient(grant, transport), { signal: signal() })).toEqual(
    { ok: true, value: { calendars: [calendar, deleted], syncToken: "complete+/=" } },
  );
  expect(transport).toHaveBeenCalledTimes(3);
  const urls = transport.mock.calls.map(([raw]) => new URL(String(raw)));
  expect(urls.map((url) => url.searchParams.get("pageToken"))).toEqual([null, "opaque+/=", "last"]);
  for (const url of urls) {
    expect(url.searchParams.get("showDeleted")).toBe("true");
    expect(url.searchParams.get("showHidden")).toBe("true");
    expect(url.searchParams.has("syncToken")).toBe(false);
  }
});

it("accepts an empty complete catalog with its terminal cursor", async () => {
  const transport = vi.fn().mockResolvedValue(response({ nextSyncToken: "empty-cursor" }));
  expect(await collect(createGoogleCalendarClient(grant, transport), { signal: signal() })).toEqual(
    { ok: true, value: { calendars: [], syncToken: "empty-cursor" } },
  );
  expect(transport).toHaveBeenCalledTimes(1);
});

it("rejects a terminal page without a sync cursor instead of returning collected calendars", async () => {
  const transport = vi.fn().mockResolvedValue(response({ items: [{ id: "incomplete" }] }));
  expect(await collect(createGoogleCalendarClient(grant, transport), { signal: signal() })).toEqual(
    { ok: false, error: { kind: "invalid_response" } },
  );
});

it("rejects a page carrying both continuation and terminal cursors", async () => {
  const transport = vi
    .fn()
    .mockResolvedValue(
      response({ items: [{ id: "ambiguous" }], nextPageToken: "next", nextSyncToken: "premature" }),
    );
  expect(await collect(createGoogleCalendarClient(grant, transport), { signal: signal() })).toEqual(
    { ok: false, error: { kind: "invalid_response" } },
  );
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each([{ tokens: ["loop", "loop"] }, { tokens: ["first", "second", "first"] }])(
  "rejects cyclic page tokens $tokens without exposing a partial catalog",
  async ({ tokens }) => {
    const transport = vi.fn();
    for (const nextPageToken of tokens)
      transport.mockResolvedValueOnce(response({ items: [], nextPageToken }));
    expect(
      await collect(createGoogleCalendarClient(grant, transport), { signal: signal() }),
    ).toEqual({ ok: false, error: { kind: "invalid_response" } });
    expect(transport).toHaveBeenCalledTimes(tokens.length);
  },
);

it.each([false, true])(
  "bounds discovery to 1000 pages while accepting a terminal cursor at the limit=%s",
  async (terminalAtLimit) => {
    let pages = 0;
    const transport = vi.fn(() => {
      pages += 1;
      return Promise.resolve(
        response(
          pages === 1001 || (terminalAtLimit && pages === 1000)
            ? { items: [], nextSyncToken: "complete-at-limit" }
            : { items: [], nextPageToken: `unique-page-${pages}` },
        ),
      );
    });
    expect(
      await collect(createGoogleCalendarClient(grant, transport), { signal: signal() }),
    ).toEqual(
      terminalAtLimit
        ? { ok: true, value: { calendars: [], syncToken: "complete-at-limit" } }
        : { ok: false, error: { kind: "invalid_response" } },
    );
    expect(transport).toHaveBeenCalledTimes(1000);
  },
);

it.each([false, true])(
  "rejects duplicate calendar IDs, including across pages=%s",
  async (acrossPages) => {
    const transport = vi.fn();
    if (acrossPages) {
      transport
        .mockResolvedValueOnce(response({ items: [{ id: "duplicate" }], nextPageToken: "next" }))
        .mockResolvedValueOnce(
          response({ items: [{ id: "duplicate", deleted: true }], nextSyncToken: "unsafe" }),
        );
    } else {
      transport.mockResolvedValueOnce(
        response({ items: [{ id: "duplicate" }, { id: "duplicate" }], nextSyncToken: "unsafe" }),
      );
    }
    expect(
      await collect(createGoogleCalendarClient(grant, transport), { signal: signal() }),
    ).toEqual({ ok: false, error: { kind: "invalid_response" } });
    expect(transport).toHaveBeenCalledTimes(acrossPages ? 2 : 1);
  },
);

it("returns a later page error without calendars or a commit cursor", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(response({ items: [{ id: "uncommitted" }], nextPageToken: "next" }))
    .mockResolvedValueOnce(response({ error: { code: 503 } }, 503));
  expect(await collect(createGoogleCalendarClient(grant, transport), { signal: signal() })).toEqual(
    { ok: false, error: { kind: "provider_unavailable", status: 503 } },
  );
  expect(transport).toHaveBeenCalledTimes(2);
});

it("rejects a malformed later page without calendars from earlier pages", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(response({ items: [{ id: "uncommitted" }], nextPageToken: "next" }))
    .mockResolvedValueOnce(response({ items: [{ id: "" }], nextSyncToken: "unsafe" }));
  expect(await collect(createGoogleCalendarClient(grant, transport), { signal: signal() })).toEqual(
    { ok: false, error: { kind: "invalid_response" } },
  );
  expect(transport).toHaveBeenCalledTimes(2);
});

it("preserves missing-scope admission without sending an HTTP request", async () => {
  const transport = vi.fn();
  expect(
    await collect(createGoogleCalendarClient({ ...grant, grantedScopes: ["openid"] }, transport), {
      signal: signal(),
    }),
  ).toEqual({ ok: false, error: { kind: "missing_scope" } });
  expect(transport).not.toHaveBeenCalled();
});

it("propagates an already-aborted signal before requesting any page", async () => {
  const controller = new AbortController();
  const reason = new DOMException("Discovery cancelled", "AbortError");
  controller.abort(reason);
  const transport = vi.fn();
  await expect(
    collect(createGoogleCalendarClient(grant, transport), { signal: controller.signal }),
  ).rejects.toBe(reason);
  expect(transport).not.toHaveBeenCalled();
});

it("checks cancellation after awaiting a page before returning its catalog and cursor", async () => {
  const controller = new AbortController();
  const reason = new DOMException("Discovery cancelled after page", "AbortError");
  const client = {
    ...createGoogleCalendarClient(grant, vi.fn()),
    calendarList: vi.fn(() => {
      controller.abort(reason);
      return Promise.resolve({
        ok: true as const,
        value: { items: [{ id: "never-commit" }], nextSyncToken: "unsafe" },
      });
    }),
  };
  await expect(collect(client, { signal: controller.signal })).rejects.toBe(reason);
  expect(client.calendarList).toHaveBeenCalledTimes(1);
});

it("recognizes writerWithoutPrivateAccess in a discovered CalendarList resource", async () => {
  const calendar = { id: "limited-writer", accessRole: "writerWithoutPrivateAccess" };
  const transport = vi
    .fn()
    .mockResolvedValue(response({ items: [calendar], nextSyncToken: "next" }));
  expect(
    await createGoogleCalendarClient(grant, transport).calendarList({ signal: signal() }),
  ).toEqual({
    ok: true,
    value: { items: [calendar], nextSyncToken: "next" },
  });
});

it("keeps writerWithoutPrivateAccess writes blocked before a private-event authority model exists", async () => {
  const transport = vi.fn();
  const calendar = {
    id: "limited-writer",
    accessRole: "writerWithoutPrivateAccess",
  } satisfies GoogleCalendarEntry;
  expect(
    await createGoogleCalendarClient(grant, transport).insertEvent({
      calendar,
      event: { id: "abc12", start: { date: "2027-03-21" }, end: { date: "2027-03-22" } },
      sendUpdates: "none",
      signal: signal(),
    }),
  ).toEqual({ ok: false, error: { kind: "calendar_read_only" } });
  expect(transport).not.toHaveBeenCalled();
});
