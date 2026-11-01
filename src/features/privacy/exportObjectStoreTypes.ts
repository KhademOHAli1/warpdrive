import type { Readable, Writable } from "node:stream";
import type { Result } from "@/types/result";
import type { PrivacyArchiveReceipt } from "./exportArchiveTypes";

export interface ExportStoreConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  requestTimeoutMs: number;
}
export interface ExportAttemptRef {
  readonly artifactId: string;
  readonly attemptId: string;
}
export interface ExportUploadRef extends ExportAttemptRef {
  readonly uploadId: string;
}
export interface ExportObjectRef extends ExportAttemptRef {
  readonly versionId: string;
}
export type ExportStoreFailure =
  | "invalid_store_config"
  | "invalid_object_ref"
  | "invalid_upload_limit"
  | "versioning_required"
  | "store_unavailable"
  | "begin_uncertain"
  | "upload_not_finished"
  | "upload_failed"
  | "quota_exceeded"
  | "receipt_mismatch"
  | "completion_uncertain"
  | "object_missing"
  | "delete_denied"
  | "delete_uncertain"
  | "abort_uncertain"
  | "inspection_limit";
export interface ExportStoredObject extends ExportObjectRef {
  bytes: number;
  sha256: string;
}
export interface ExportObjectUpload {
  ref: ExportUploadRef;
  sink: Writable;
  complete(
    receipt: PrivacyArchiveReceipt,
    signal: AbortSignal,
  ): Promise<Result<ExportStoredObject, ExportStoreFailure>>;
}
export interface ExportObjectStore {
  allocate(): ExportAttemptRef;
  begin(
    ref: ExportAttemptRef,
    limits: { maxBytes: number },
    signal: AbortSignal,
  ): Promise<Result<ExportObjectUpload, ExportStoreFailure>>;
  open(ref: ExportObjectRef, signal: AbortSignal): Promise<Result<Readable, ExportStoreFailure>>;
  stat(
    ref: ExportObjectRef,
    signal: AbortSignal,
  ): Promise<Result<{ bytes: number; etag: string }, ExportStoreFailure>>;
  remove(
    ref: ExportObjectRef,
    signal: AbortSignal,
  ): Promise<Result<"absent_verified", ExportStoreFailure>>;
  abort(
    ref: ExportUploadRef,
    signal: AbortSignal,
  ): Promise<Result<"upload_absent_verified", ExportStoreFailure>>;
  inspect(
    ref: ExportAttemptRef,
    signal: AbortSignal,
  ): Promise<
    Result<
      { objects: { ref: ExportObjectRef; deleteMarker: boolean }[]; uploads: ExportUploadRef[] },
      ExportStoreFailure
    >
  >;
}
