import { err, ok } from "@/types/result";
import { catalogJsonBytes, MAX_CATALOG_BYTES, MAX_CATALOG_ENTRIES } from "./catalogStorage";
import type { GoogleCalendarClient } from "./client";
import type { GoogleResult, SignalInput } from "./contracts";
import type { GoogleCalendarEntry, GoogleCalendarListPage } from "./schemas";

const MAX_CALENDAR_DISCOVERY_PAGES = 1_000;

function validCalendarPage(
  page: GoogleCalendarListPage,
  calendarIds: Set<string>,
  pageTokens: Set<string>,
): boolean {
  const next = page.nextPageToken;
  if (next !== undefined && (page.nextSyncToken !== undefined || pageTokens.has(next)))
    return false;
  for (const calendar of page.items) {
    if (calendarIds.has(calendar.id)) return false;
    calendarIds.add(calendar.id);
  }
  return true;
}

// Full-snapshot transport only. The future catalog owner must persist the complete
// result atomically; a failed or ambiguous page never exposes a commit cursor.
export async function collectGoogleCalendarDiscovery(
  client: GoogleCalendarClient,
  input: SignalInput,
): Promise<GoogleResult<{ calendars: GoogleCalendarEntry[]; syncToken: string }>> {
  const calendars: GoogleCalendarEntry[] = [];
  const calendarIds = new Set<string>();
  const pageTokens = new Set<string>();
  let bytes = 0;
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_CALENDAR_DISCOVERY_PAGES; page += 1) {
    input.signal.throwIfAborted();
    const result = await client.calendarList({ ...input, pageToken });
    input.signal.throwIfAborted();
    if (!result.ok) return result;
    if (!validCalendarPage(result.value, calendarIds, pageTokens))
      return err({ kind: "invalid_response" });
    bytes += result.value.items.reduce((total, entry) => total + catalogJsonBytes(entry), 0);
    if (
      bytes > MAX_CATALOG_BYTES ||
      calendars.length + result.value.items.length > MAX_CATALOG_ENTRIES
    )
      return err({ kind: "invalid_response" });
    calendars.push(...result.value.items);
    const next = result.value.nextPageToken;
    const final = result.value.nextSyncToken;
    if (next === undefined)
      return final === undefined
        ? err({ kind: "invalid_response" })
        : ok({ calendars, syncToken: final });
    pageTokens.add(next);
    pageToken = next;
  }
  return err({ kind: "invalid_response" });
}
