import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { ok, type Result } from "@/types/result";
import { createGoogleCalendarClient, type GoogleCalendarClient } from "./client";
import type { GoogleCalendarError, GoogleTransport } from "./contracts";
import type { GoogleEvent } from "./schemas";

export const readableRoles = ["reader", "writerWithoutPrivateAccess", "writer", "owner"] as const;
export type ReadableRole = (typeof readableRoles)[number];
export interface PageInput {
  calendarId: string;
  syncToken?: string;
  expectedAccessRole: ReadableRole;
  signal: AbortSignal;
}
export interface StagedPage {
  ordinal: number;
  accessRole: ReadableRole;
  items: readonly GoogleEvent[];
}
export interface Completion {
  accessRole: ReadableRole;
  syncToken: string;
  pages: number;
  events: number;
  bytes: number;
}
export type Visitor = <E>(
  client: Pick<GoogleCalendarClient, "eventsList">,
  input: PageInput,
  stage: (page: StagedPage, signal: AbortSignal) => Promise<Result<void, E>>,
) => Promise<Result<Completion, GoogleCalendarError | { kind: "catalog_changed" } | E>>;

// Loading inside each visitor case keeps an absent future API distinct from the
// client-schema assertion in the first case. Absence is not behavioral RED.
export async function loadVisitor(): Promise<Visitor> {
  const api = await import("./eventSyncPages");
  return api.visitGoogleEventSyncPages;
}

export const pageSignal = () => AbortSignal.timeout(3_000);
export function input(overrides: Partial<PageInput> = {}): PageInput {
  return {
    calendarId: "team/a?b@example.invalid",
    expectedAccessRole: "writer",
    signal: pageSignal(),
    ...overrides,
  };
}
export const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const response = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });

export function syntheticPages(pages: readonly unknown[]) {
  const urls: string[] = [];
  const signals: AbortSignal[] = [];
  const transport: GoogleTransport = (url, init) => {
    init.signal.throwIfAborted();
    const index = urls.push(url) - 1;
    signals.push(init.signal);
    if (index >= pages.length)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "unexpected extra synthetic event page");
    const page = pages[index];
    return Promise.resolve(page instanceof Response ? page : response(page));
  };
  const client = createGoogleCalendarClient(
    {
      accessToken: "synthetic-event-pages-token",
      grantedScopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    },
    transport,
  );
  return { client, urls, signals };
}

export function recordingStage() {
  const pages: StagedPage[] = [];
  const stage = (page: StagedPage, signal: AbortSignal) => {
    signal.throwIfAborted();
    pages.push(page);
    return Promise.resolve(ok(undefined));
  };
  return { pages, stage };
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "event page gate not initialized");
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function waitGate<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new AppError(ERROR_IDS.DB_INVARIANT, "event page gate aborted"),
      );
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

function depthEvent(depth: number) {
  let opaque: unknown = "leaf";
  for (let level = 1; level < depth; level += 1) opaque = { child: opaque };
  return { id: "depth", opaque };
}

export function invalidPages() {
  const page = (fields: object) => ({ accessRole: "writer", ...fields });
  return [
    { pages: [page({ items: [{ id: "incomplete" }] })], staged: 0 },
    { pages: [page({ nextPageToken: "next", nextSyncToken: "premature" })], staged: 0 },
    { pages: [page({ nextPageToken: "loop" }), page({ nextPageToken: "loop" })], staged: 1 },
    {
      pages: [page({ items: [{ id: "same" }, { id: "same" }], nextSyncToken: "done" })],
      staged: 0,
    },
    {
      pages: [
        page({ items: [{ id: "same" }], nextPageToken: "next" }),
        page({ items: [{ id: "same", status: "cancelled" }], nextSyncToken: "done" }),
      ],
      staged: 1,
    },
    {
      pages: [page({ items: [{ id: "unsafe", opaque: "nul\u0000value" }], nextSyncToken: "done" })],
      staged: 0,
    },
    { pages: [page({ items: [depthEvent(33)], nextSyncToken: "done" })], staged: 0 },
    { pages: [page({ nextPageToken: "nul\u0000cursor" })], staged: 0 },
    { pages: [page({ nextSyncToken: "lone\ud800cursor" })], staged: 0 },
    { pages: [page({ nextPageToken: "x".repeat(64 * 1024 + 1) })], staged: 0 },
  ];
}

export function rawRecurrenceEvents() {
  const master = {
    id: "series/opaque",
    etag: '"master"',
    summary: "جلسه / Termin",
    start: { dateTime: "2030-03-20T09:00:00+03:30", timeZone: "Asia/Tehran" },
    end: { dateTime: "2030-03-20T10:00:00+03:30", timeZone: "Asia/Tehran" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE", "EXDATE;TZID=Asia/Tehran:20300327T090000"],
    futureField: { preserve: ["opaque", true] },
  };
  const moved = {
    id: "series/opaque_20300320T053000Z",
    recurringEventId: master.id,
    originalStartTime: { dateTime: "2030-03-20T09:00:00+03:30", timeZone: "Asia/Tehran" },
    start: { dateTime: "2030-03-21T11:00:00+03:30", timeZone: "Asia/Tehran" },
    end: { dateTime: "2030-03-21T12:00:00+03:30", timeZone: "Asia/Tehran" },
  };
  const allDay = {
    id: "all_day",
    start: { date: "2030-03-20" },
    end: { date: "2030-03-21" },
    recurrence: ["RRULE:FREQ=DAILY;COUNT=3"],
  };
  const cancelled = {
    id: "all_day_20300321",
    status: "cancelled",
    recurringEventId: allDay.id,
    originalStartTime: { date: "2030-03-21" },
  };
  return [master, allDay, moved, cancelled, { id: "sparse/gone", status: "cancelled" }];
}
