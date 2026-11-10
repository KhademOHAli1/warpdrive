import { z } from "zod";
import { err } from "@/types/result";
import {
  type GoogleCalendarGrant,
  type GoogleResult,
  hasCalendarScope,
  type SignalInput,
} from "./contracts";
import {
  eventInsertSchema,
  eventPatchSchema,
  type GoogleCalendarEntry,
  type GoogleEvent,
  type GoogleEventInsert,
  type GoogleEventPatch,
  type GoogleSendUpdates,
  googleEventSchema,
  sendUpdatesSchema,
} from "./schemas";
import type { CalendarRequest } from "./transport";

interface WriteContext extends SignalInput {
  calendar: GoogleCalendarEntry;
  sendUpdates: GoogleSendUpdates;
  meetRequestId?: string;
}
export interface InsertEventInput extends WriteContext {
  event: GoogleEventInsert;
}
export interface DeleteEventInput extends Omit<WriteContext, "meetRequestId"> {
  eventId: string;
  etag: string;
}
export interface PatchEventInput extends WriteContext {
  eventId: string;
  etag: string;
  patch: GoogleEventPatch;
  conferenceCacheReady: boolean;
}
function writeGate(grant: GoogleCalendarGrant, input: WriteContext): GoogleResult<undefined> {
  input.signal.throwIfAborted();
  if (!hasCalendarScope(grant, "events_write")) return err({ kind: "missing_scope" });
  if (
    input.calendar.deleted === true ||
    !["writer", "owner"].includes(input.calendar.accessRole ?? "none")
  )
    return err({ kind: "calendar_read_only" });
  if (!sendUpdatesSchema.safeParse(input.sendUpdates).success)
    return err({ kind: "invalid_input" });
  if (input.meetRequestId !== undefined) {
    if (!z.string().min(1).safeParse(input.meetRequestId).success)
      return err({ kind: "invalid_input" });
    if (
      input.calendar.conferenceProperties?.allowedConferenceSolutionTypes?.includes(
        "hangoutsMeet",
      ) !== true
    )
      return err({ kind: "conference_not_supported" });
  }
  return { ok: true, value: undefined };
}
function requestBody(
  event: GoogleEventInsert | GoogleEventPatch,
  meetRequestId: string | undefined,
): object {
  return meetRequestId === undefined
    ? event
    : {
        ...event,
        conferenceData: {
          createRequest: {
            requestId: meetRequestId,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      };
}
export function googleWrites(grant: GoogleCalendarGrant, request: CalendarRequest) {
  return {
    async insertEvent(input: InsertEventInput): Promise<GoogleResult<GoogleEvent>> {
      const gate = writeGate(grant, input);
      if (!gate.ok) return Promise.resolve(gate);
      const parsed = eventInsertSchema.safeParse(input.event);
      if (!parsed.success) return Promise.resolve(err({ kind: "invalid_input" }));
      const query = new URLSearchParams({
        sendUpdates: input.sendUpdates,
        conferenceDataVersion: "1",
      });
      return request(
        {
          path: ["calendars", input.calendar.id, "events"],
          query,
          method: "POST",
          body: requestBody(parsed.data, input.meetRequestId),
        },
        googleEventSchema,
        input.signal,
      );
    },
    async deleteEvent(input: DeleteEventInput): Promise<GoogleResult<null>> {
      const gate = writeGate(grant, input);
      if (!gate.ok) return gate;
      if (input.etag.length === 0 || input.eventId.length === 0)
        return err({ kind: "invalid_input" });
      return request(
        {
          path: ["calendars", input.calendar.id, "events", input.eventId],
          query: new URLSearchParams({ sendUpdates: input.sendUpdates }),
          method: "DELETE",
          etag: input.etag,
        },
        z.null(),
        input.signal,
      );
    },
    async patchEvent(input: PatchEventInput): Promise<GoogleResult<GoogleEvent>> {
      const gate = writeGate(grant, input);
      if (!gate.ok) return Promise.resolve(gate);
      // A future mirror must record this readiness after a complete conference-aware sync.
      // This transport never upgrades an existing cache implicitly or strips conference data.
      if (!input.conferenceCacheReady)
        return Promise.resolve(err({ kind: "conference_sync_required" }));
      const parsed = eventPatchSchema.safeParse(input.patch);
      if (
        !parsed.success ||
        (Object.keys(parsed.data).length === 0 && input.meetRequestId === undefined) ||
        input.etag.length === 0 ||
        input.eventId.length === 0
      )
        return Promise.resolve(err({ kind: "invalid_input" }));
      const query = new URLSearchParams({
        sendUpdates: input.sendUpdates,
        conferenceDataVersion: "1",
      });
      return request(
        {
          path: ["calendars", input.calendar.id, "events", input.eventId],
          query,
          method: "PATCH",
          etag: input.etag,
          body: requestBody(parsed.data, input.meetRequestId),
        },
        googleEventSchema,
        input.signal,
      );
    },
  };
}
