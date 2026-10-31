import { z } from "zod";
import type { MailboxConnectionError, MailboxConnectionView } from "./connections/types";
import { mailboxCapabilitiesSchema } from "./mailConnectionSchemas";

const endpointMetadata = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  security: z.enum(["tls", "starttls"]),
  username: z.string().min(1).max(1024),
});
const configuration = z.object({ imap: endpointMetadata, smtp: endpointMetadata });
const sentSettings = z.object({
  sentCopyMode: z.enum(["crm_only", "append"]).optional(),
  sentFolderPath: z.string().min(1).max(1024).optional(),
});
const folderPaths = z.array(z.string().min(1).max(1024)).max(1000);
const syncProgress = z.object({
  processed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  skipReasons: z.object({
    messageTooLarge: z.number().int().nonnegative(),
    invalidMessage: z.number().int().nonnegative(),
    messageMissing: z.number().int().nonnegative(),
  }),
});

export function publicMailboxProgress(value: unknown): MailboxConnectionView["syncProgress"] {
  const parsed = syncProgress.safeParse(value);
  return parsed.success ? { ...parsed.data, total: null } : undefined;
}

export function publicMailboxSettings(
  value: unknown,
): Pick<MailboxConnectionView, "configuration" | "sentCopyMode" | "sentFolderPath"> {
  const endpoints = configuration.safeParse(value);
  const sent = sentSettings.safeParse(value);
  return {
    ...(endpoints.success ? { configuration: endpoints.data } : {}),
    ...(sent.success ? sent.data : {}),
  };
}

export function publicMailboxFolders(value: unknown): string[] | undefined {
  const parsed = folderPaths.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function publicMailboxCapabilities(value: unknown): MailboxConnectionView["capabilities"] {
  const parsed = mailboxCapabilitiesSchema.strip().safeParse(value);
  return parsed.success
    ? parsed.data
    : { read: false, send: false, markRead: false, move: false, trash: false };
}

export function publicRevocationStatus(
  provider: string,
  status: string,
  remote: string | null,
): MailboxConnectionView["remoteRevocationStatus"] {
  if (status !== "disconnected") return "not_required";
  if (provider !== "gmail") return "manual";
  if (remote === "revoked") return "complete";
  return remote === null ? "manual" : "pending";
}

const KNOWN_MAILBOX_ERRORS: Readonly<Record<string, MailboxConnectionError>> = {
  E_GMAIL_001: "network",
  E_GMAIL_002: "authentication",
  E_GMAIL_005: "unknown",
  E_MAIL_001: "connection_changed",
  E_MAIL_002: "invalid_input",
  E_MAIL_003: "network",
  E_MAIL_006: "unsupported",
  E_MAIL_007: "connection_changed",
  E_PERM_001: "permission",
};
const folderError = z.enum([
  "authentication",
  "tls",
  "network",
  "permission",
  "unsupported",
  "unknown",
]);

export function publicMailboxError(
  lastError: string | null,
  folderKind: string | null,
  status: string,
): MailboxConnectionError | undefined {
  if (folderKind !== null) {
    const parsed = folderError.safeParse(folderKind);
    return parsed.success ? parsed.data : "unknown";
  }
  if (lastError !== null)
    return Object.hasOwn(KNOWN_MAILBOX_ERRORS, lastError)
      ? (KNOWN_MAILBOX_ERRORS[lastError] ?? "unknown")
      : "unknown";
  return status === "error" ? "unknown" : undefined;
}

export function publicMailboxStatus(
  status: MailboxConnectionView["status"],
  paused: boolean,
  error: MailboxConnectionError | undefined,
): MailboxConnectionView["status"] {
  if (status === "disconnected") return status;
  if (paused) return "paused";
  return error === undefined ? status : "error";
}
