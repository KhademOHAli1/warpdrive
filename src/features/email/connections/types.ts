import type { Result } from "@/types/result";

export type MailboxConnectionError =
  | "authentication"
  | "tls"
  | "network"
  | "permission"
  | "duplicate"
  | "invalid_input"
  | "rate_limit"
  | "stale_check"
  | "fresh_auth_required"
  | "unsupported"
  | "connection_changed"
  | "delivery_unknown"
  | "unknown";

export interface MailboxCapabilities {
  read: boolean;
  send: boolean;
  markRead: boolean;
  move: boolean;
  trash: boolean;
}

export type MailboxSentCopyMode = "crm_only" | "append";

export interface MailboxConnectionView {
  id: string;
  provider: "gmail" | "imap_smtp";
  emailAddress: string;
  displayName?: string;
  status: "connected" | "paused" | "error" | "disconnected";
  isDefault: boolean;
  lastSyncAtIso: string | null;
  capabilities: MailboxCapabilities;
  errorCode?: MailboxConnectionError;
  historyDays?: number;
  folderPaths?: string[];
  sentCopyMode?: MailboxSentCopyMode;
  sentFolderPath?: string;
  configuration?: {
    imap: Omit<MailboxEndpointInput, "password">;
    smtp: Omit<MailboxEndpointInput, "password">;
  };
  syncProgress?: {
    processed: number;
    total: number | null;
    skipped?: number;
    skipReasons?: { messageTooLarge: number; invalidMessage: number; messageMissing: number };
  };
  remoteRevocationStatus?: "not_required" | "pending" | "complete" | "manual";
}

export interface MailboxEndpointInput {
  host: string;
  port: number;
  security: "tls" | "starttls";
  username: string;
  password: string;
}

export interface CheckMailboxInput {
  accountId?: string;
  emailAddress: string;
  displayName?: string;
  imap: MailboxEndpointInput;
  smtp: MailboxEndpointInput;
}

export interface MailboxFolder {
  path: string;
  name: string;
  role: "inbox" | "sent" | "other";
  readOnly: boolean | null;
}

export interface CheckedMailboxConnection {
  checkId: string;
  mailboxAddress: string;
  folders: MailboxFolder[];
  capabilities: MailboxCapabilities;
}

export interface SaveMailboxInput {
  checkId: string;
  folderPaths: string[];
  historyDays: number;
  isDefault: boolean;
  sentCopyMode?: MailboxSentCopyMode;
  sentFolderPath?: string;
}

export type MailboxConnectionMutation = "pause" | "resume" | "retry" | "disconnect" | "setDefault";
export type MailboxConnectionResult<T> = Result<T, MailboxConnectionError>;

export interface MailboxConnectionActions {
  check: (
    input: CheckMailboxInput,
    signal: AbortSignal,
  ) => Promise<MailboxConnectionResult<CheckedMailboxConnection>>;
  save: (
    input: SaveMailboxInput,
    signal: AbortSignal,
  ) => Promise<MailboxConnectionResult<MailboxConnectionView>>;
  mutate: (
    accountId: string,
    action: MailboxConnectionMutation,
    signal: AbortSignal,
  ) => Promise<MailboxConnectionResult<void>>;
  connectGmail?: (signal: AbortSignal) => Promise<MailboxConnectionResult<void>>;
}
