import { z } from "zod";

// Only trusted server-side notification preparation may create this persisted purpose.
// Public compose and MCP input schemas intentionally have no corresponding field.
export interface NotificationSendPurpose {
  version: 1;
  kind: "notification";
  notificationId: string;
  recipientUserId: string;
}

// PostgreSQL emits lowercase hyphenated UUIDs without imposing RFC version bits.
// Require that canonical text here; changing stored IDs would hide malformed purpose.
const canonicalPgUuid = z.guid().refine((value) => value === value.toLowerCase());
const notificationSendPurposeSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("notification"),
  notificationId: canonicalPgUuid,
  recipientUserId: canonicalPgUuid,
});

export function parseNotificationSendPurpose(input: unknown): NotificationSendPurpose | null {
  const parsed = notificationSendPurposeSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
