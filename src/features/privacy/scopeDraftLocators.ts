import { z } from "zod";

export const scopeDraftUuid = z.uuid().transform((value) => value.toLowerCase());
const uuidStores = [
  "activities",
  "auth_users",
  "change_logs",
  "comments",
  "custom_field_defs",
  "deals",
  "files",
  "leads",
  "notes",
  "organizations",
  "persons",
  "users",
] as const;
const mailboxStores = ["email_messages", "email_threads", "email_drafts"] as const;
export const scopeDraftLocatorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("uuid"), store: z.enum(uuidStores), id: scopeDraftUuid }),
  z.strictObject({
    kind: z.literal("mailbox"),
    store: z.enum(mailboxStores),
    id: scopeDraftUuid,
    accountId: scopeDraftUuid,
  }),
  z.strictObject({
    kind: z.literal("activity_guest"),
    store: z.literal("activity_guests"),
    activityId: scopeDraftUuid,
    personId: scopeDraftUuid,
  }),
  z.strictObject({
    kind: z.literal("activity_participant"),
    store: z.literal("activity_participants"),
    activityId: scopeDraftUuid,
    userId: scopeDraftUuid,
  }),
  z.strictObject({
    kind: z.literal("deal_participant"),
    store: z.literal("deal_participants"),
    dealId: scopeDraftUuid,
    personId: scopeDraftUuid,
  }),
]);
export type ScopeDraftLocator = z.infer<typeof scopeDraftLocatorSchema>;

// Mailbox context is required, but a globally unique native primary key cannot name two mailboxes.
export function scopeDraftNativeKey(locator: ScopeDraftLocator): string {
  if (locator.kind === "uuid" || locator.kind === "mailbox")
    return `${locator.store}:${locator.id}`;
  if (locator.kind === "activity_guest")
    return `${locator.store}:${locator.activityId}:${locator.personId}`;
  if (locator.kind === "activity_participant")
    return `${locator.store}:${locator.activityId}:${locator.userId}`;
  return `${locator.store}:${locator.dealId}:${locator.personId}`;
}
