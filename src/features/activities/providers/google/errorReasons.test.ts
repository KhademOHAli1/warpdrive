import { expect, it, vi } from "vitest";
import { createGoogleCalendarClient } from "./client";

const grant = {
  accessToken: "synthetic",
  grantedScopes: ["https://www.googleapis.com/auth/calendar.events"],
};
const signal = () => AbortSignal.timeout(5_000);
it.each(["userRateLimitExceeded", "rateLimitExceeded"])(
  "classifies allowlisted quota reason %s as retryable without retaining provider messages",
  async (reason) => {
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            message: "private provider detail",
            errors: [{ reason, message: "another private message" }],
          },
        }),
        { status: 403, headers: { "Retry-After": "30" } },
      ),
    );
    const result = await createGoogleCalendarClient(grant, transport).getEvent({
      calendarId: "primary",
      eventId: "abc123",
      signal: signal(),
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "rate_limited", status: 403, retryAfterSeconds: 30 },
    });
    expect(transport).toHaveBeenCalledTimes(1);
  },
);
it.each([
  "forbidden",
  "forbiddenForNonOrganizer",
  "quotaExceeded",
  "rateLimitExceededButNotReally",
])("keeps non-allowlisted 403 reason %s forbidden", async (reason) => {
  const transport = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ error: { errors: [{ reason }] } }), { status: 403 }),
    );
  expect(
    await createGoogleCalendarClient(grant, transport).getEvent({
      calendarId: "primary",
      eventId: "abc123",
      signal: signal(),
    }),
  ).toEqual({ ok: false, error: { kind: "forbidden", status: 403 } });
});
it("falls back to HTTP permission classification for malformed 403 bodies and preserves cancellation", async () => {
  const client = createGoogleCalendarClient(
    grant,
    vi.fn().mockResolvedValue(new Response("invalid JSON", { status: 403 })),
  );
  expect(
    await client.getEvent({ calendarId: "primary", eventId: "abc123", signal: signal() }),
  ).toEqual({ ok: false, error: { kind: "forbidden", status: 403 } });
  const controller = new AbortController();
  const res = new Response("{}", { status: 403 });
  res.json = () => {
    controller.abort();
    return Promise.reject(new DOMException("cancelled", "AbortError"));
  };
  const aborted = createGoogleCalendarClient(grant, vi.fn().mockResolvedValue(res));
  await expect(
    aborted.getEvent({ calendarId: "primary", eventId: "abc123", signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
});
