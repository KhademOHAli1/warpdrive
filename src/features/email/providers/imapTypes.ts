import type { ApprovedEndpoint } from "@/features/connections/connectionEndpoint";
import type { SmtpTimeouts } from "./smtpTypes";

export interface ImapTransportConfig {
  endpoint: ApprovedEndpoint;
  username: string;
  password: string;
  timeouts?: Partial<SmtpTimeouts>;
}

export type ImapFailure = {
  kind:
    | "invalid_request"
    | "authentication"
    | "tls"
    | "connection"
    | "connection_changed"
    | "timeout"
    | "protocol"
    | "mailbox_missing"
    | "message_missing"
    | "read_only"
    | "uidvalidity_changed"
    | "unsupported"
    | "message_too_large"
    | "mutation_unknown";
};

export interface ImapFolderPage {
  path: string;
  uidValidity: string;
  uidNext: number;
  readOnly: boolean;
  messageCount: number;
  lastUid: number;
  nextAfterUid: number | null;
  hasMore: boolean;
  messages: {
    uid: number;
    flags: string[];
    internalDate: Date | null;
    source: Buffer;
  }[];
  skipped: { uid: number; reason: "message_too_large" | "message_missing" }[];
}

export interface ImapReadArgs {
  path: string;
  since?: Date;
  afterUid?: number;
  limit?: number;
  signal: AbortSignal;
}

export interface ImapMessageArgs {
  path: string;
  uidValidity: string;
  uid: number;
  signal: AbortSignal;
}

export interface ImapMutationArgs {
  path: string;
  uidValidity: string;
  uids: number[];
  signal: AbortSignal;
}

export interface ImapWriteArgs extends ImapMutationArgs {
  beforeMutation?: (signal: AbortSignal) => Promise<boolean>;
}

export const IMAP_LIMITS = {
  pageMessages: 100,
  searchUidWindow: 4096,
  batchBytes: 32 * 1024 * 1024,
  responseLineBytes: 64 * 1024,
  folderCount: 1000,
  listResponseBytes: 4 * 1024 * 1024,
  fetchRows: 512,
  fetchResponseBytes: 32 * 1024 * 1024,
  sessionResponseBytes: 64 * 1024 * 1024,
} as const;
