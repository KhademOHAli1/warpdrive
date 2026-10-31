import { z } from "zod";
import type { CheckedMailboxConnection, MailboxConnectionView } from "./types";

export const mailboxConnectionErrorSchema = z.enum([
  "authentication",
  "tls",
  "network",
  "permission",
  "duplicate",
  "invalid_input",
  "rate_limit",
  "stale_check",
  "fresh_auth_required",
  "unsupported",
  "connection_changed",
  "delivery_unknown",
  "unknown",
]);
const capabilitiesSchema = z.object({
  read: z.boolean(),
  send: z.boolean(),
  markRead: z.boolean(),
  move: z.boolean(),
  trash: z.boolean(),
});
const endpointMetadataSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  security: z.enum(["tls", "starttls"]),
  username: z.string().min(1).max(1024),
});
export const mailboxViewSchema: z.ZodType<MailboxConnectionView> = z.object({
  id: z.string().min(1).max(128),
  provider: z.enum(["gmail", "imap_smtp"]),
  emailAddress: z.string().min(1).max(320),
  displayName: z.string().max(256).optional(),
  status: z.enum(["connected", "paused", "error", "disconnected"]),
  isDefault: z.boolean(),
  lastSyncAtIso: z.string().datetime({ offset: true }).nullable(),
  capabilities: capabilitiesSchema,
  errorCode: mailboxConnectionErrorSchema.optional(),
  historyDays: z.number().int().min(1).max(3650).optional(),
  folderPaths: z.array(z.string().min(1).max(4096)).max(10_000).optional(),
  sentCopyMode: z.enum(["crm_only", "append"]).optional(),
  sentFolderPath: z.string().min(1).max(4096).optional(),
  configuration: z
    .object({ imap: endpointMetadataSchema, smtp: endpointMetadataSchema })
    .optional(),
  syncProgress: z
    .object({
      processed: z.number().int().min(0),
      total: z.number().int().min(0).nullable(),
      skipped: z.number().int().min(0).optional(),
      skipReasons: z
        .object({
          messageTooLarge: z.number().int().min(0),
          invalidMessage: z.number().int().min(0),
          messageMissing: z.number().int().min(0),
        })
        .optional(),
    })
    .optional(),
  remoteRevocationStatus: z.enum(["not_required", "pending", "complete", "manual"]).optional(),
});
export const checkedMailboxSchema: z.ZodType<CheckedMailboxConnection> = z.object({
  checkId: z.string().min(1).max(256),
  mailboxAddress: z.string().min(1).max(320),
  capabilities: capabilitiesSchema,
  folders: z
    .array(
      z.object({
        path: z.string().min(1).max(4096),
        name: z.string().max(4096),
        role: z.enum(["inbox", "sent", "other"]),
        readOnly: z.boolean().nullable(),
      }),
    )
    .max(10_000),
});
