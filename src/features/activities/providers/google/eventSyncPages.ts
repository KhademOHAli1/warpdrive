import { err, ok, type Result } from "@/types/result";
import type { GoogleCalendarClient } from "./client";
import type { GoogleCalendarError } from "./contracts";
import {
  admitEventSyncPage,
  createEventSyncBudget,
  hasEventSyncPageBudget,
} from "./eventSyncBudget";
import type { GoogleEvent } from "./schemas";

export type ReadableCalendarRole = "reader" | "writerWithoutPrivateAccess" | "writer" | "owner";
export interface EventSyncPageInput {
  calendarId: string;
  syncToken?: string;
  expectedAccessRole: ReadableCalendarRole;
  signal: AbortSignal;
}
export interface StagedEventPage {
  ordinal: number;
  accessRole: ReadableCalendarRole;
  items: readonly GoogleEvent[];
}
export interface EventSyncCompletion {
  accessRole: ReadableCalendarRole;
  syncToken: string;
  pages: number;
  events: number;
  bytes: number;
}

function readableRole(role: string | undefined): role is ReadableCalendarRole {
  return (
    role === "reader" ||
    role === "writerWithoutPrivateAccess" ||
    role === "writer" ||
    role === "owner"
  );
}

export async function visitGoogleEventSyncPages<E>(
  client: Pick<GoogleCalendarClient, "eventsList">,
  input: EventSyncPageInput,
  stage: (page: StagedEventPage, signal: AbortSignal) => Promise<Result<void, E>>,
): Promise<Result<EventSyncCompletion, GoogleCalendarError | { kind: "catalog_changed" } | E>> {
  const budget = createEventSyncBudget();
  let pageToken: string | undefined;
  while (hasEventSyncPageBudget(budget)) {
    input.signal.throwIfAborted();
    const result = await client.eventsList({
      calendarId: input.calendarId,
      syncToken: input.syncToken,
      pageToken,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    if (!result.ok) return result;
    const role = result.value.accessRole;
    if (!readableRole(role) || role !== input.expectedAccessRole)
      return err({ kind: "catalog_changed" });
    const cursor = admitEventSyncPage(budget, result.value);
    if (cursor === null) return err({ kind: "invalid_response" });
    const staged = await stage(
      { ordinal: budget.pages - 1, accessRole: role, items: result.value.items },
      input.signal,
    );
    input.signal.throwIfAborted();
    if (!staged.ok) return staged;
    if (cursor.kind === "complete")
      return ok({
        accessRole: role,
        syncToken: cursor.token,
        pages: budget.pages,
        events: budget.events,
        bytes: budget.bytes,
      });
    pageToken = cursor.token;
  }
  return err({ kind: "invalid_response" });
}
