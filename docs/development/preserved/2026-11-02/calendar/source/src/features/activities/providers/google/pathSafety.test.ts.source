import { expect, it, vi } from "vitest";
import { createGoogleCalendarClient } from "./client";

const grant = {
  accessToken: "synthetic",
  grantedScopes: ["https://www.googleapis.com/auth/calendar.events"],
};
const calendar = { id: "primary", accessRole: "writer" as const };
const event = { id: "a1b2c3d4", start: { date: "2027-03-21" }, end: { date: "2027-03-22" } };
const signal = () => AbortSignal.timeout(5_000);

it.each([".", "..", "...", "", "\ud800"])(
  "rejects unsafe event identity %j before every event-specific request",
  async (eventId) => {
    const transport = vi.fn().mockResolvedValue(new Response("{}"));
    const client = createGoogleCalendarClient(grant, transport);
    const results = [
      await client.getEvent({ calendarId: calendar.id, eventId, signal: signal() }),
      await client.patchEvent({
        calendar,
        eventId,
        etag: '"v1"',
        patch: { summary: "Change" },
        sendUpdates: "none",
        conferenceCacheReady: true,
        signal: signal(),
      }),
      await client.deleteEvent({
        calendar,
        eventId,
        etag: '"v1"',
        sendUpdates: "none",
        signal: signal(),
      }),
    ];
    for (const result of results)
      expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(transport).not.toHaveBeenCalled();
  },
);

it.each([".", "..", "...", "", "\ud800"])(
  "rejects unsafe calendar identity %j before list/read/create/patch/delete",
  async (calendarId) => {
    const transport = vi.fn().mockResolvedValue(new Response("{}"));
    const client = createGoogleCalendarClient(grant, transport);
    const target = { ...calendar, id: calendarId };
    const results = [
      await client.eventsList({ calendarId, signal: signal() }),
      await client.getEvent({ calendarId, eventId: event.id, signal: signal() }),
      await client.insertEvent({ calendar: target, event, sendUpdates: "none", signal: signal() }),
      await client.patchEvent({
        calendar: target,
        eventId: event.id,
        etag: '"v1"',
        patch: { summary: "Change" },
        sendUpdates: "none",
        conferenceCacheReady: true,
        signal: signal(),
      }),
      await client.deleteEvent({
        calendar: target,
        eventId: event.id,
        etag: '"v1"',
        sendUpdates: "none",
        signal: signal(),
      }),
    ];
    for (const result of results)
      expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(transport).not.toHaveBeenCalled();
  },
);

it("preserves opaque recurring event identities with underscores", async () => {
  const eventId = "abc123_20270321T053000Z";
  const transport = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ id: eventId, etag: '"v1"' })));
  expect(
    await createGoogleCalendarClient(grant, transport).getEvent({
      calendarId: "team@example.invalid",
      eventId,
      signal: signal(),
    }),
  ).toMatchObject({ ok: true, value: { id: eventId } });
  expect(new URL(String(transport.mock.calls[0]?.[0])).pathname).toBe(
    `/calendar/v3/calendars/team%40example.invalid/events/${eventId}`,
  );
});
