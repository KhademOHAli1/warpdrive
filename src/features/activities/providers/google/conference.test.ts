import { expect, it, vi } from "vitest";
import { createGoogleCalendarClient } from "./client";
import { googleConferenceState } from "./conference";

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

it("requests Meet with a persisted request identity and returns pending before a join link exists", async () => {
  const transport = vi.fn().mockResolvedValue(
    response({
      conferenceData: {
        createRequest: { requestId: "stable-intent-id", status: { statusCode: "pending" } },
      },
    }),
  );
  const client = createGoogleCalendarClient(grant, transport);
  const result = await client.insertEvent({
    calendar,
    event,
    sendUpdates: "externalOnly",
    meetRequestId: "stable-intent-id",
    signal: signal(),
  });
  expect(result.ok && googleConferenceState(result.value)).toEqual({
    state: "pending",
    requestId: "stable-intent-id",
  });
  const [raw, init] = transport.mock.calls[0] ?? [];
  expect(new URL(String(raw)).searchParams.get("conferenceDataVersion")).toBe("1");
  expect(JSON.parse(String(init.body)).conferenceData).toEqual({
    createRequest: {
      requestId: "stable-intent-id",
      conferenceSolutionKey: { type: "hangoutsMeet" },
    },
  });
});

it("refuses unsupported Meet and never invents a link for failure or incomplete success", async () => {
  const transport = vi.fn();
  const result = await createGoogleCalendarClient(grant, transport).insertEvent({
    calendar: { ...calendar, conferenceProperties: { allowedConferenceSolutionTypes: [] } },
    event,
    sendUpdates: "none",
    meetRequestId: "stable",
    signal: signal(),
  });
  expect(result).toMatchObject({ ok: false, error: { kind: "conference_not_supported" } });
  expect(transport).not.toHaveBeenCalled();
  const client = createGoogleCalendarClient(
    grant,
    vi.fn().mockResolvedValue(
      response({
        conferenceData: { createRequest: { requestId: "x", status: { statusCode: "failure" } } },
      }),
    ),
  );
  const failed = await client.getEvent({
    calendarId: calendar.id,
    eventId: event.id,
    signal: signal(),
  });
  expect(failed.ok && googleConferenceState(failed.value)).toEqual({
    state: "failed",
    requestId: "x",
  });
});

it.each(["https://meet.google.com/abc-defg-hij", "javascript:alert(1)"])(
  "returns ready only for a valid returned video URI: %s",
  async (uri) => {
    const client = createGoogleCalendarClient(
      grant,
      vi.fn().mockResolvedValue(
        response({
          conferenceData: {
            createRequest: { requestId: "x", status: { statusCode: "success" } },
            conferenceSolution: { key: { type: "hangoutsMeet" } },
            entryPoints: [{ entryPointType: "video", uri }],
          },
        }),
      ),
    );
    const result = await client.getEvent({
      calendarId: calendar.id,
      eventId: event.id,
      signal: signal(),
    });
    expect(result.ok && googleConferenceState(result.value)).toEqual(
      uri.startsWith("https:")
        ? { state: "ready", url: uri, requestId: "x" }
        : { state: "unavailable", requestId: "x" },
    );
  },
);

it("keeps Meet unavailable after success with no returned video entry point", async () => {
  const client = createGoogleCalendarClient(
    grant,
    vi.fn().mockResolvedValue(
      response({
        conferenceData: {
          createRequest: { requestId: "x", status: { statusCode: "success" } },
          conferenceSolution: { key: { type: "hangoutsMeet" } },
        },
      }),
    ),
  );
  const result = await client.getEvent({
    calendarId: calendar.id,
    eventId: event.id,
    signal: signal(),
  });
  expect(result.ok && googleConferenceState(result.value)).toEqual({
    state: "unavailable",
    requestId: "x",
  });
});

it("removes an event conditionally with an explicit cancellation-notification decision", async () => {
  const transport = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  const result = await createGoogleCalendarClient(grant, transport).deleteEvent({
    calendar,
    eventId: event.id,
    etag: '"v2"',
    sendUpdates: "all",
    signal: signal(),
  });
  expect(result).toEqual({ ok: true, value: null });
  const [raw, init] = transport.mock.calls[0] ?? [];
  expect(init).toMatchObject({ method: "DELETE", headers: { "If-Match": '"v2"' } });
  expect(new URL(String(raw)).searchParams.get("sendUpdates")).toBe("all");
});

it("can provision Meet on an existing event without changing ordinary fields", async () => {
  const transport = vi.fn().mockResolvedValue(
    response({
      conferenceData: {
        createRequest: { requestId: "conference-only", status: { statusCode: "pending" } },
      },
    }),
  );
  const client = createGoogleCalendarClient(grant, transport);
  const result = await client.patchEvent({
    calendar,
    eventId: event.id,
    etag: '"v1"',
    patch: {},
    sendUpdates: "none",
    meetRequestId: "conference-only",
    conferenceCacheReady: true,
    signal: signal(),
  });
  expect(result.ok && googleConferenceState(result.value)).toEqual({
    state: "pending",
    requestId: "conference-only",
  });
  expect(JSON.parse(String(transport.mock.calls[0]?.[1].body))).toEqual({
    conferenceData: {
      createRequest: {
        requestId: "conference-only",
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  });
  expect(
    await client.patchEvent({
      calendar,
      eventId: event.id,
      etag: '"v1"',
      patch: {},
      sendUpdates: "none",
      conferenceCacheReady: true,
      signal: signal(),
    }),
  ).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
  expect(transport).toHaveBeenCalledTimes(1);
});
