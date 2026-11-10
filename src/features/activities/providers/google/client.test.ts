import { expect, it, vi } from "vitest";
import { createGoogleCalendarClient } from "./client";
import { collectGoogleEventSync } from "./sync";

const scopes = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];
const grant = { accessToken: "synthetic-calendar-token", grantedScopes: scopes };
const signal = () => AbortSignal.timeout(5_000);
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const event = {
  id: "abc12",
  etag: '"v1"',
  status: "confirmed",
  summary: "جلسه / Termin",
  start: { dateTime: "2027-03-21T09:00:00+03:30" },
  end: { dateTime: "2027-03-21T10:00:00+03:30" },
};

it("discovers calendar capability and continues with an opaque encoded page token", async () => {
  const transport = vi.fn().mockResolvedValue(
    response({
      items: [
        {
          id: "team@example.invalid",
          summary: "تیم / Team",
          accessRole: "writer",
          conferenceProperties: { allowedConferenceSolutionTypes: ["hangoutsMeet"] },
        },
      ],
      nextPageToken: "next+/=",
    }),
  );
  const client = createGoogleCalendarClient(grant, transport);
  const first = await client.calendarList({ signal: signal() });
  expect(first).toMatchObject({
    ok: true,
    value: {
      nextPageToken: "next+/=",
      items: [
        {
          accessRole: "writer",
          conferenceProperties: { allowedConferenceSolutionTypes: ["hangoutsMeet"] },
        },
      ],
    },
  });
  await client.calendarList({ pageToken: "next+/=", signal: signal() });
  const [url, init] = transport.mock.calls[1] ?? [];
  expect(new URL(String(url)).searchParams.get("pageToken")).toBe("next+/=");
  expect(init).toMatchObject({
    headers: { Authorization: "Bearer synthetic-calendar-token" },
    signal: expect.any(AbortSignal),
  });
});

it("does not treat Gmail or sign-in consent as Calendar authorization", async () => {
  const transport = vi.fn();
  const client = createGoogleCalendarClient(
    {
      ...grant,
      grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.modify"],
    },
    transport,
  );
  expect(await client.calendarList({ signal: signal() })).toMatchObject({
    ok: false,
    error: { kind: "missing_scope" },
  });
  expect(await client.eventsList({ calendarId: "primary", signal: signal() })).toMatchObject({
    ok: false,
    error: { kind: "missing_scope" },
  });
  expect(transport).not.toHaveBeenCalled();
});

it("collects complete event sync with sparse deleted exceptions and a final cursor only", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(response({ items: [event], nextPageToken: "page2" }))
    .mockResolvedValueOnce(
      response({
        items: [
          {
            id: "gone",
            status: "cancelled",
            recurringEventId: "series",
            originalStartTime: { date: "2027-03-21" },
          },
        ],
        nextSyncToken: "cursor2",
      }),
    );
  const result = await collectGoogleEventSync(createGoogleCalendarClient(grant, transport), {
    calendarId: "team/a?b",
    syncToken: "old+/=",
    signal: signal(),
  });
  expect(result).toMatchObject({
    ok: true,
    value: {
      syncToken: "cursor2",
      events: [{ id: "abc12" }, { id: "gone", status: "cancelled", recurringEventId: "series" }],
    },
  });
  for (const [raw] of transport.mock.calls) {
    const url = new URL(String(raw));
    expect(url.pathname).toContain("team%2Fa%3Fb");
    expect(url.searchParams.get("syncToken")).toBe("old+/=");
    expect(url.searchParams.get("showDeleted")).toBe("true");
    expect(url.searchParams.get("singleEvents")).toBe("false");
    expect(url.searchParams.has("timeMin")).toBe(false);
  }
  expect(new URL(String(transport.mock.calls[1]?.[0])).searchParams.get("pageToken")).toBe("page2");
});

it("requires a mirror rebuild on 410 without returning partial event pages", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(response({ items: [event], nextPageToken: "last" }))
    .mockResolvedValueOnce(response({ error: { code: 410 } }, 410));
  const result = await collectGoogleEventSync(createGoogleCalendarClient(grant, transport), {
    calendarId: "primary",
    syncToken: "expired",
    signal: signal(),
  });
  expect(result).toEqual({ ok: false, error: { kind: "sync_expired", status: 410 } });
  expect(transport).toHaveBeenCalledTimes(2);
});

it.each([{ items: [], nextPageToken: "loop" }, { items: [] }])(
  "rejects incomplete or cyclic sync pages without a commit cursor",
  async (body) => {
    const transport = vi.fn().mockResolvedValue(response(body));
    const result = await collectGoogleEventSync(createGoogleCalendarClient(grant, transport), {
      calendarId: "primary",
      signal: signal(),
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
    expect(transport.mock.calls.length).toBeLessThanOrEqual(2);
  },
);

it("preserves exact ETag and provider event fields on reads", async () => {
  const transport = vi.fn().mockResolvedValue(
    response({
      ...event,
      conferenceData: {
        signature: "opaque",
        conferenceSolution: { key: { type: "futureProvider" } },
      },
      extendedProperties: { private: { external: "keep" } },
    }),
  );
  const result = await createGoogleCalendarClient(grant, transport).getEvent({
    calendarId: "primary",
    eventId: "abc12",
    signal: signal(),
  });
  expect(result).toMatchObject({
    ok: true,
    value: {
      etag: '"v1"',
      conferenceData: {
        signature: "opaque",
        conferenceSolution: { key: { type: "futureProvider" } },
      },
      extendedProperties: { private: { external: "keep" } },
    },
  });
});
