import type { Readable } from "node:stream";
import type { Result } from "@/types/result";

export interface PrivacyArchiveSource {
  path: string;
  open(signal: AbortSignal): Promise<Result<Readable, "source_unavailable">>;
}
export type PrivacyArchiveFailure =
  | "manifest_blocked"
  | "invalid_archive_manifest"
  | "entry_unapproved"
  | "entry_duplicate"
  | "entry_missing"
  | "entry_size_mismatch"
  | "entry_checksum_mismatch"
  | "source_unavailable"
  | "source_read_failed"
  | "archive_write_failed";
export interface PrivacyArchiveReceipt {
  format: "tar.gz";
  sha256: string;
  bytes: number;
  files: number;
}
export interface ExpectedArchiveEntry {
  bytes: number;
  sha256: string;
}
export interface ArchiveOperation {
  signal: AbortSignal;
  failure(): PrivacyArchiveFailure | null;
  fail(code: PrivacyArchiveFailure): void;
}
