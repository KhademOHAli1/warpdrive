import { expect, it, vi } from "vitest";
import { collectGoogleCalendarDiscovery } from "./calendarDiscovery";
import { createGoogleCalendarClient } from "./client";

function catalogPages(total: number, summary = "") {
  let offset = 0;
  const transport = vi.fn(() => {
    const count = Math.min(250, total - offset);
    const items = Array.from({ length: count }, (_, index) => ({
      id: `opaque-${offset + index}`,
      summary,
    }));
    offset += count;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          items,
          ...(offset < total ? { nextPageToken: `page-${offset}` } : { nextSyncToken: "done" }),
        }),
      ),
    );
  });
  const client = createGoogleCalendarClient(
    {
      accessToken: "synthetic-catalog-budget-token",
      grantedScopes: ["https://www.googleapis.com/auth/calendar.calendarlist.readonly"],
    },
    transport,
  );
  return { client, transport };
}

it("admits a complete catalog at the 10000-entry operational limit", async () => {
  const { client, transport } = catalogPages(10_000);
  const result = await collectGoogleCalendarDiscovery(client, {
    signal: AbortSignal.timeout(5_000),
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.calendars).toHaveLength(10_000);
    expect(result.value.syncToken).toBe("done");
  }
  expect(transport).toHaveBeenCalledTimes(40);
});

it("rejects an oversized catalog without exposing its calendars or cursor", async () => {
  const { client, transport } = catalogPages(10_001);
  expect(
    await collectGoogleCalendarDiscovery(client, { signal: AbortSignal.timeout(5_000) }),
  ).toEqual({ ok: false, error: { kind: "invalid_response" } });
  expect(transport).toHaveBeenCalledTimes(41);
});

it("bounds aggregate catalog payload bytes even when each individual entry is admissible", async () => {
  const { client, transport } = catalogPages(300, "x".repeat(60_000));
  expect(
    await collectGoogleCalendarDiscovery(client, { signal: AbortSignal.timeout(5_000) }),
  ).toEqual({ ok: false, error: { kind: "invalid_response" } });
  expect(transport).toHaveBeenCalledTimes(2);
});
