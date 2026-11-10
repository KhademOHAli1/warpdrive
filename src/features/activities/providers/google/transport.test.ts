import { describe, expect, it, vi } from "vitest";
import { createGoogleCalendarClient } from "./client";

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

describe("transport failures", () => {
  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [412, "conflict"],
    [429, "rate_limited"],
    [503, "provider_unavailable"],
  ])("classifies HTTP %i without retaining provider payload or token", async (status, kind) => {
    const transport = vi.fn().mockResolvedValue(response({ secret: "never-log" }, Number(status)));
    const result = await createGoogleCalendarClient(grant, transport).getEvent({
      calendarId: "primary",
      eventId: "abc12",
      signal: signal(),
    });
    expect(result).toEqual({ ok: false, error: { kind, status } });
  });
  it("returns invalid_response for invalid JSON or invalid event identity", async () => {
    for (const res of [new Response("not-json"), response({ summary: "missing id" })]) {
      const client = createGoogleCalendarClient(grant, vi.fn().mockResolvedValue(res));
      expect(
        await client.getEvent({ calendarId: "primary", eventId: "abc12", signal: signal() }),
      ).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
    }
  });
  it("returns network failures and propagates abort rather than swallowing cancellation", async () => {
    const transport = vi.fn().mockRejectedValue(new TypeError("network unavailable"));
    const client = createGoogleCalendarClient(grant, transport);
    expect(
      await client.getEvent({ calendarId: "primary", eventId: "abc12", signal: signal() }),
    ).toEqual({ ok: false, error: { kind: "network" } });
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.getEvent({ calendarId: "primary", eventId: "abc12", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

it("exposes bounded retry metadata for throttling without retrying inside the transport", async () => {
  const transport = vi
    .fn()
    .mockResolvedValue(new Response("{}", { status: 429, headers: { "Retry-After": "120" } }));
  const result = await createGoogleCalendarClient(grant, transport).getEvent({
    calendarId: "primary",
    eventId: "abc12",
    signal: signal(),
  });
  expect(result).toEqual({
    ok: false,
    error: { kind: "rate_limited", status: 429, retryAfterSeconds: 120 },
  });
  expect(transport).toHaveBeenCalledTimes(1);
});

it("propagates abort while reading a response body", async () => {
  const controller = new AbortController();
  const res = response(event);
  res.json = () => {
    controller.abort();
    return Promise.reject(new DOMException("aborted", "AbortError"));
  };
  const client = createGoogleCalendarClient(grant, vi.fn().mockResolvedValue(res));
  await expect(
    client.getEvent({ calendarId: "primary", eventId: "abc12", signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("does not treat a gone single event as an expired sync cursor", async () => {
  const client = createGoogleCalendarClient(grant, vi.fn().mockResolvedValue(response({}, 410)));
  expect(
    await client.getEvent({ calendarId: "primary", eventId: "gone", signal: signal() }),
  ).toEqual({ ok: false, error: { kind: "not_found", status: 410 } });
});
