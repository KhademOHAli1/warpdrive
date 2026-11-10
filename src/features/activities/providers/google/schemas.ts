import { z } from "zod";
import { calendarEntryFitsStorage } from "./catalogStorage";

const nonempty = z.string().min(1);
export const calendarEntrySchema = z
  .looseObject({
    id: nonempty,
    summary: z.string().optional(),
    summaryOverride: z.string().optional(),
    etag: nonempty.optional(),
    hidden: z.boolean().optional(),
    timeZone: z.string().optional(),
    accessRole: z
      .enum(["none", "freeBusyReader", "reader", "writerWithoutPrivateAccess", "writer", "owner"])
      .optional(),
    deleted: z.boolean().optional(),
    primary: z.boolean().optional(),
    conferenceProperties: z
      .looseObject({ allowedConferenceSolutionTypes: z.array(z.string()).optional() })
      .optional(),
  })
  .refine(calendarEntryFitsStorage);
export type GoogleCalendarEntry = z.infer<typeof calendarEntrySchema>;
export const calendarListPageSchema = z.object({
  items: z.array(calendarEntrySchema).default([]),
  nextPageToken: nonempty.optional(),
  nextSyncToken: nonempty.optional(),
});
export type GoogleCalendarListPage = z.infer<typeof calendarListPageSchema>;
const eventDateSchema = z.looseObject({
  date: z.string().optional(),
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
});
const conferenceSchema = z.looseObject({
  createRequest: z
    .looseObject({
      requestId: nonempty.optional(),
      status: z.object({ statusCode: z.enum(["pending", "success", "failure"]) }).optional(),
    })
    .optional(),
  conferenceSolution: z.looseObject({ key: z.object({ type: z.string() }) }).optional(),
  entryPoints: z.array(z.looseObject({ entryPointType: z.string(), uri: z.string() })).optional(),
});
// Deleted events may contain only an ID. Keep opaque provider fields for a future mirror,
// including recurrence exception identity and conference signatures, without round-tripping them as native fields.
export const googleEventSchema = z.looseObject({
  id: nonempty,
  etag: nonempty.optional(),
  status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
  summary: z.string().optional(),
  start: eventDateSchema.optional(),
  end: eventDateSchema.optional(),
  recurringEventId: nonempty.optional(),
  originalStartTime: eventDateSchema.optional(),
  conferenceData: conferenceSchema.optional(),
});
export type GoogleEvent = z.infer<typeof googleEventSchema>;
export const eventPageSchema = z.object({
  accessRole: z.string().optional(),
  items: z.array(googleEventSchema).default([]),
  nextPageToken: nonempty.optional(),
  nextSyncToken: nonempty.optional(),
});
export type GoogleEventPage = z.infer<typeof eventPageSchema>;
const dateInputSchema = z.union([
  z.strictObject({ date: z.iso.date() }),
  z.strictObject({ dateTime: z.iso.datetime({ offset: true }), timeZone: nonempty.optional() }),
]);
const eventFields = {
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: dateInputSchema,
  end: dateInputSchema,
  visibility: z.enum(["default", "public", "private"]).optional(),
  transparency: z.enum(["opaque", "transparent"]).optional(),
};
export const eventInsertSchema = z.strictObject({
  id: z.string().regex(/^[0-9a-v]{5,1024}$/),
  ...eventFields,
});
export type GoogleEventInsert = z.infer<typeof eventInsertSchema>;
export const eventPatchSchema = z.strictObject(eventFields).partial();
export type GoogleEventPatch = z.infer<typeof eventPatchSchema>;
export const sendUpdatesSchema = z.enum(["all", "externalOnly", "none"]);
export type GoogleSendUpdates = z.infer<typeof sendUpdatesSchema>;
