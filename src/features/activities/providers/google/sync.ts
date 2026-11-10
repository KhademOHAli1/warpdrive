import { err, ok } from "@/types/result";
import type { GoogleCalendarClient } from "./client";
import type { GoogleResult, SignalInput } from "./contracts";
import {
  admitEventSyncPage,
  createEventSyncBudget,
  hasEventSyncPageBudget,
} from "./eventSyncBudget";
import type { GoogleEvent } from "./schemas";

// Transport collection only. The future mirror must publish the complete result
// atomically; invalid/failed pages expose neither partial events nor a cursor.
export async function collectGoogleEventSync(
  client: GoogleCalendarClient,
  input: SignalInput & { calendarId: string; syncToken?: string },
): Promise<GoogleResult<{ events: GoogleEvent[]; syncToken: string }>> {
  const budget = createEventSyncBudget();
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  while (hasEventSyncPageBudget(budget)) {
    input.signal.throwIfAborted();
    const result = await client.eventsList({ ...input, pageToken });
    input.signal.throwIfAborted();
    if (!result.ok) return result;
    const cursor = admitEventSyncPage(budget, result.value);
    if (cursor === null) return err({ kind: "invalid_response" });
    for (const event of result.value.items) events.push(event);
    if (cursor.kind === "complete") return ok({ events, syncToken: cursor.token });
    pageToken = cursor.token;
  }
  return err({ kind: "invalid_response" });
}
