import type { AppError } from "@/constants/errorIds";
import type { StorageClient } from "@/features/files/storage";
import type { Result } from "@/types/result";
import type { GmailClient } from "./gmailClient";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";

export interface AttachmentDownloadDeps {
  resolveClient: (accountId: string, signal: AbortSignal) => Promise<Result<GmailClient, AppError>>;
  loadConnection?: (
    accountId: string,
    signal: AbortSignal,
  ) => Promise<Result<ImapConnectionRuntime, AppError>>;
  storage?: StorageClient;
}

export interface AttachmentDownload {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}
