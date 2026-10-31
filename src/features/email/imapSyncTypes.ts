import type { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { Result } from "@/types/result";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import type { ImapFolderPage } from "./providers/imapTypes";
import type { RawParsedMail } from "./providers/rawMimeTypes";

export interface ImapSyncDependencies {
  loadConnection?: (
    db: Db,
    accountId: string,
    signal: AbortSignal,
  ) => Promise<Result<ImapConnectionRuntime, AppError>>;
  maxPages?: number;
}

export interface ImapSyncOutcome {
  applied: number;
  skipped: number;
  more: boolean;
  stale: boolean;
  deferred?: boolean;
}

export interface ImapFolderCheckpoint {
  id: string;
  path: string;
  uidValidity: string;
  lastUid: number;
  historySince: Date;
  reconcileAfterUid: number;
  notificationAfter: Date;
  isSentFolder: boolean;
  version: string;
}

export interface PreparedImapMessage {
  uid: number;
  flags: string[];
  internalDate: Date | null;
  fingerprint: string;
  parsed: RawParsedMail;
}

export interface PreparedImapPage {
  page: ImapFolderPage;
  messages: PreparedImapMessage[];
  skipped: { uid: number; reason: "message_too_large" | "invalid_message" | "message_missing" }[];
}
