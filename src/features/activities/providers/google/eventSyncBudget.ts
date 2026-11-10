import {
  eventCursorBytes,
  eventStorageBytes,
  MAX_EVENT_PAGE_TOKEN_BYTES,
  MAX_EVENT_SYNC_BYTES,
  MAX_EVENT_SYNC_EVENTS,
  MAX_EVENT_SYNC_PAGES,
} from "./eventStorage";
import type { GoogleEvent, GoogleEventPage } from "./schemas";

export interface EventSyncBudget {
  pages: number;
  events: number;
  bytes: number;
  ids: Set<string>;
  tokens: Set<string>;
  tokenBytes: number;
}

export type EventSyncCursor =
  | { kind: "page"; token: string; bytes: number }
  | { kind: "complete"; token: string };

export function createEventSyncBudget(): EventSyncBudget {
  return { pages: 0, events: 0, bytes: 0, ids: new Set(), tokens: new Set(), tokenBytes: 0 };
}

export function hasEventSyncPageBudget(budget: EventSyncBudget): boolean {
  return budget.pages < MAX_EVENT_SYNC_PAGES;
}

function pageCursor(budget: EventSyncBudget, page: GoogleEventPage): EventSyncCursor | null {
  const next = page.nextPageToken;
  if (next === undefined) {
    const final = page.nextSyncToken;
    return final === undefined || eventCursorBytes(final) === null
      ? null
      : { kind: "complete", token: final };
  }
  const bytes = eventCursorBytes(next);
  if (
    page.nextSyncToken !== undefined ||
    budget.pages + 1 >= MAX_EVENT_SYNC_PAGES ||
    budget.tokens.has(next) ||
    bytes === null ||
    budget.tokenBytes + bytes > MAX_EVENT_PAGE_TOKEN_BYTES
  )
    return null;
  return { kind: "page", token: next, bytes };
}

function pageEventBytes(
  budget: EventSyncBudget,
  events: readonly GoogleEvent[],
  ids: Set<string>,
): number | null {
  if (budget.events + events.length > MAX_EVENT_SYNC_EVENTS) return null;
  let total = 0;
  for (const event of events) {
    if (budget.ids.has(event.id) || ids.has(event.id)) return null;
    const bytes = eventStorageBytes(event);
    if (bytes === null || budget.bytes + total + bytes > MAX_EVENT_SYNC_BYTES) return null;
    ids.add(event.id);
    total += bytes;
  }
  return total;
}

// Commit counters only after the complete current page and cursor pass. This
// prevents the visitor from exposing part of an offending page to its sink.
export function admitEventSyncPage(
  budget: EventSyncBudget,
  page: GoogleEventPage,
): EventSyncCursor | null {
  if (!hasEventSyncPageBudget(budget)) return null;
  const cursor = pageCursor(budget, page);
  if (cursor === null) return null;
  const ids = new Set<string>();
  const bytes = pageEventBytes(budget, page.items, ids);
  if (bytes === null) return null;
  for (const id of ids) budget.ids.add(id);
  budget.pages += 1;
  budget.events += page.items.length;
  budget.bytes += bytes;
  if (cursor.kind === "page") {
    budget.tokens.add(cursor.token);
    budget.tokenBytes += cursor.bytes;
  }
  return cursor;
}
