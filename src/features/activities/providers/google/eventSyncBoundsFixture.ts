import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { createGoogleCalendarClient } from "@/features/activities/providers/google/client";
import type {
  GoogleResult,
  GoogleTransport,
} from "@/features/activities/providers/google/contracts";
import type { GoogleEvent } from "@/features/activities/providers/google/schemas";
import { collectGoogleEventSync } from "@/features/activities/providers/google/sync";

export const MAX_PAGES = 1_000;
export const MAX_EVENTS = 50_000;
export const MAX_EVENT_BYTES = 1024 * 1024;
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_DEPTH = 32;
export const grant = {
  accessToken: "synthetic-event-sync-bounds-token",
  grantedScopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
};
const encoder = new TextEncoder();
export const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;

export function syntheticPages(page: (index: number) => unknown) {
  const urls: string[] = [];
  const transport: GoogleTransport = (url, init) => {
    init.signal.throwIfAborted();
    const index = urls.push(url) - 1;
    return Promise.resolve(new Response(JSON.stringify(page(index))));
  };
  return { transport, urls };
}

export async function runPages(
  page: (index: number) => unknown,
  input: { signal?: AbortSignal; syncToken?: string } = {},
) {
  const source = syntheticPages(page);
  const result = await collectGoogleEventSync(createGoogleCalendarClient(grant, source.transport), {
    calendarId: "team/a?b@example.invalid",
    signal: input.signal ?? AbortSignal.timeout(30_000),
    ...(input.syncToken === undefined ? {} : { syncToken: input.syncToken }),
  });
  return { result, urls: source.urls };
}

export function compact(result: GoogleResult<{ events: GoogleEvent[]; syncToken: string }>) {
  return result.ok
    ? {
        ok: true,
        count: result.value.events.length,
        cursor: result.value.syncToken,
        hasValue: true,
      }
    : { ok: false, kind: result.error.kind, hasValue: "value" in result };
}

export function sizedEvent(id: string, bytes: number, multibyte = false) {
  const remaining = bytes - jsonBytes({ id, opaquePayload: "" });
  if (remaining < 0) throw new AppError(ERROR_IDS.DB_INVARIANT, "event byte fixture too small");
  const opaquePayload = multibyte
    ? "é".repeat(Math.floor(remaining / 2)) + "x".repeat(remaining % 2)
    : "x".repeat(remaining);
  return { id, opaquePayload };
}

export function depthEvent(depth: number) {
  let opaque: unknown = "leaf";
  for (let level = 1; level < depth; level += 1) opaque = { child: opaque };
  return { id: `depth_${depth}`, opaque };
}

export function countedPages(total: number) {
  return (page: number) => {
    const start = page * 2_500;
    const count = Math.min(2_500, total - start);
    if (count <= 0) throw new AppError(ERROR_IDS.DB_INVARIANT, "extra counted event page");
    return {
      items: Array.from({ length: count }, (_, offset) => ({ id: `event_${start + offset}` })),
      ...(start + count < total
        ? { nextPageToken: `page_${page + 1}` }
        : { nextSyncToken: "counted-complete" }),
    };
  };
}

export async function aggregateOutcome(overflow: boolean) {
  const { result, urls } = await runPages((page) => {
    if (page < 32)
      return {
        items: [sizedEvent(`aggregate_${String(page).padStart(2, "0")}`, MAX_EVENT_BYTES)],
        ...(page < 31 || overflow
          ? { nextPageToken: `page_${page + 1}` }
          : { nextSyncToken: "aggregate-complete" }),
      };
    if (page === 32 && overflow)
      return {
        items: [{ id: "aggregate_overflow" }],
        nextSyncToken: "must-not-publish",
      };
    throw new AppError(ERROR_IDS.DB_INVARIANT, "extra aggregate event page");
  });
  return { ...compact(result), calls: urls.length };
}
