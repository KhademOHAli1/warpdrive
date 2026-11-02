import { err } from "@/types/result";
import {
  type EventIdentity,
  type EventPageInput,
  type GoogleCalendarGrant,
  type GoogleResult,
  type GoogleTransport,
  hasCalendarScope,
  type SignalInput,
} from "./contracts";
import {
  calendarListPageSchema,
  eventPageSchema,
  type GoogleCalendarListPage,
  type GoogleEvent,
  type GoogleEventPage,
  googleEventSchema,
} from "./schemas";
import { calendarTransport, googleFetch } from "./transport";
import { googleWrites } from "./writes";

export function createGoogleCalendarClient(
  grant: GoogleCalendarGrant,
  transport: GoogleTransport = googleFetch,
) {
  const request = calendarTransport(grant, transport);
  return {
    async calendarList(
      input: SignalInput & { pageToken?: string },
    ): Promise<GoogleResult<GoogleCalendarListPage>> {
      input.signal.throwIfAborted();
      if (!hasCalendarScope(grant, "calendar_list"))
        return Promise.resolve(err({ kind: "missing_scope" }));
      const query = new URLSearchParams({
        showDeleted: "true",
        showHidden: "true",
        maxResults: "250",
      });
      if (input.pageToken !== undefined) query.set("pageToken", input.pageToken);
      return request(
        { path: ["users", "me", "calendarList"], query },
        calendarListPageSchema,
        input.signal,
      );
    },
    async eventsList(input: EventPageInput): Promise<GoogleResult<GoogleEventPage>> {
      input.signal.throwIfAborted();
      if (!hasCalendarScope(grant, "events_read"))
        return Promise.resolve(err({ kind: "missing_scope" }));
      // Keep identical query shape for full and incremental sync; no time filters or expansion.
      const query = new URLSearchParams({
        showDeleted: "true",
        singleEvents: "false",
        maxResults: "2500",
      });
      if (input.pageToken !== undefined) query.set("pageToken", input.pageToken);
      if (input.syncToken !== undefined) query.set("syncToken", input.syncToken);
      const result = await request(
        { path: ["calendars", input.calendarId, "events"], query },
        eventPageSchema,
        input.signal,
      );
      if (!result.ok && result.error.status === 410)
        return err({ kind: "sync_expired", status: 410 });
      return result;
    },
    async getEvent(input: EventIdentity): Promise<GoogleResult<GoogleEvent>> {
      input.signal.throwIfAborted();
      if (!hasCalendarScope(grant, "events_read"))
        return Promise.resolve(err({ kind: "missing_scope" }));
      return request(
        {
          path: ["calendars", input.calendarId, "events", input.eventId],
        },
        googleEventSchema,
        input.signal,
      );
    },
    ...googleWrites(grant, request),
  };
}
export type GoogleCalendarClient = ReturnType<typeof createGoogleCalendarClient>;
