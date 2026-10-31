import { z } from "zod";
import {
  MAILBOX_MAX_HISTORY_DAYS,
  MAILBOX_MAX_SELECTED_FOLDERS,
} from "@/constants/mailConnections";
import { isValidMailRecipient } from "./recipientAddress";

export const mailboxEndpointInputSchema = z.strictObject({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  security: z.enum(["tls", "starttls"]),
  username: z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => !value.includes("\0")),
  password: z
    .string()
    .min(1)
    .max(8192)
    .refine((value) => !value.includes("\0")),
});

export const checkMailboxInputSchema = z.strictObject({
  accountId: z.uuid().optional(),
  emailAddress: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email({ pattern: z.regexes.unicodeEmail }))
    .refine(isValidMailRecipient),
  displayName: z
    .string()
    .trim()
    .max(200)
    .refine((value) => !/\p{Cc}/u.test(value))
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional(),
  imap: mailboxEndpointInputSchema,
  smtp: mailboxEndpointInputSchema,
});

export const mailboxCapabilitiesSchema = z.strictObject({
  read: z.boolean(),
  send: z.boolean(),
  markRead: z.boolean(),
  move: z.boolean(),
  trash: z.boolean(),
});

export const checkedMailboxSchema = z.strictObject({
  input: checkMailboxInputSchema,
  identityKey: z.string().min(1).max(200),
  generation: z.number().int().positive().optional(),
  folders: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(1024),
        name: z.string().max(1024),
        role: z.enum(["inbox", "sent", "other"]),
        readOnly: z.boolean().nullable(),
      }),
    )
    .max(1000),
  capabilities: mailboxCapabilitiesSchema,
});

export const saveMailboxInputSchema = z.strictObject({
  checkId: z.string().regex(/^[a-f0-9]{64}$/),
  folderPaths: z.array(z.string().min(1).max(1024)).min(1).max(MAILBOX_MAX_SELECTED_FOLDERS),
  historyDays: z.number().int().min(1).max(MAILBOX_MAX_HISTORY_DAYS),
  isDefault: z.boolean(),
  sentCopyMode: z.enum(["crm_only", "append"]).default("crm_only"),
  sentFolderPath: z.string().min(1).max(1024).optional(),
});

export type CheckedMailbox = z.infer<typeof checkedMailboxSchema>;
export interface MailboxActorSession {
  actorId: string;
  sessionId: string;
}
