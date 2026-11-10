import { expect, it, vi } from "vitest";
import { createGoogleCalendarClient } from "./client";

const grant = {
  accessToken: "synthetic",
  grantedScopes: ["https://www.googleapis.com/auth/calendar.events"],
};
const calendar = {
  id: "team@example.invalid",
  accessRole: "writer" as const,
  conferenceProperties: { allowedConferenceSolutionTypes: ["hangoutsMeet"] },
};
const event = {
  id: "a1b2c3d4",
  summary: "نوروز / Nowruz",
  start: { date: "2027-03-21" },
  end: { date: "2027-03-22" },
};
const signal = () => AbortSignal.timeout(5_000);
const response = (extra: object = {}) =>
  new Response(JSON.stringify({ ...event, etag: '"v2"', ...extra }));

it("requires deterministic event id and explicit notification decision on create", async () => {
  const transport = vi.fn().mockResolvedValue(response());
  const client = createGoogleCalendarClient(grant, transport);
  expect(
    await client.insertEvent({ calendar, event, sendUpdates: "none", signal: signal() }),
  ).toMatchObject({ ok: true, value: { id: event.id } });
  const [raw, init] = transport.mock.calls[0] ?? [];
  expect(new URL(String(raw)).searchParams.get("sendUpdates")).toBe("none");
  expect(init).toMatchObject({ method: "POST" });
  expect(JSON.parse(String(init.body))).toEqual(event);
  for (const invalid of [
    { ...event, id: "bad-uuid" },
    { ...event, id: undefined },
  ]) {
    expect(
      await client.insertEvent({
        calendar,
        event: invalid as typeof event,
        sendUpdates: "none",
        signal: signal(),
      }),
    ).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
  }
  expect(
    await client.insertEvent({
      calendar,
      event,
      sendUpdates: undefined as unknown as "none",
      signal: signal(),
    }),
  ).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
  expect(transport).toHaveBeenCalledTimes(1);
});

it("sends If-Match and surfaces conflicts without overwriting or retrying", async () => {
  const transport = vi.fn().mockResolvedValue(new Response("", { status: 412 }));
  const result = await createGoogleCalendarClient(grant, transport).patchEvent({
    calendar,
    eventId: event.id,
    etag: '"v1"',
    patch: { summary: "Geändert" },
    sendUpdates: "all",
    conferenceCacheReady: true,
    signal: signal(),
  });
  expect(result).toEqual({ ok: false, error: { kind: "conflict", status: 412 } });
  const [raw, init] = transport.mock.calls[0] ?? [];
  expect(init).toMatchObject({ method: "PATCH", headers: { "If-Match": '"v1"' } });
  expect(new URL(String(raw)).searchParams.get("sendUpdates")).toBe("all");
  expect(transport).toHaveBeenCalledTimes(1);
});

it("blocks existing-cache writes before conference-aware full sync and blocks read-only calendars", async () => {
  const transport = vi.fn();
  const client = createGoogleCalendarClient(grant, transport);
  expect(
    await client.patchEvent({
      calendar,
      eventId: event.id,
      etag: '"v1"',
      patch: { summary: "new" },
      sendUpdates: "none",
      conferenceCacheReady: false,
      signal: signal(),
    }),
  ).toMatchObject({ ok: false, error: { kind: "conference_sync_required" } });
  expect(
    await client.insertEvent({
      calendar: { ...calendar, accessRole: "reader" },
      event,
      sendUpdates: "none",
      signal: signal(),
    }),
  ).toMatchObject({ ok: false, error: { kind: "calendar_read_only" } });
  expect(transport).not.toHaveBeenCalled();
});
