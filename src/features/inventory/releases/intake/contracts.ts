import { type ReleaseArtifactKind, releaseArtifactKinds } from "../contracts";

export const exportIntakeKinds = [...releaseArtifactKinds, "pcbSource"] as const;
export const exportIntakeMaxFiles = 16;
export const exportIntakeMaxTotalBytes = 100 * 1024 * 1024;
export const exportManifestMaxBytes = 32 * 1024;

export type ExportIntakeKind = ReleaseArtifactKind;
export type ExportIntakeBinding = {
  itemId: string;
  releaseId: string;
  sku: string;
  revision: string;
};

export type ExportManifestFile = {
  kind: ExportIntakeKind;
  name: string;
  sizeBytes: number;
  sha256: string;
};

export type ExportManifest = {
  schemaVersion: 1;
  exporter: { name: "kicad" | "engineering_pipeline"; version: string; sourceRevision: string };
  target: { sku: string; revision: string };
  files: ExportManifestFile[];
};

export type ExportIntakeIssueCode =
  | "manifest"
  | "wrongTarget"
  | "missingFile"
  | "extraFile"
  | "duplicateFile"
  | "fileSize"
  | "fileType"
  | "hashMismatch"
  | "draftChanged"
  | "conflict"
  | "unavailable"
  | "temporary";

export type ExportIntakeIssue = { code: ExportIntakeIssueCode; file?: string };
export type ExportIntakeState = "queued" | "working" | "ready" | "failed" | "cancelled";

export type ExportIntakeJob = {
  id: string;
  submittedAt: string;
  target: ExportIntakeBinding;
  manifest: ExportManifest;
  state: ExportIntakeState;
  attempts: {
    id: string;
    at: string;
    outcome: "ready" | "failed" | "cancelled";
    issue: ExportIntakeIssue | null;
  }[];
  artifacts: { id: string; kind: ExportIntakeKind; name: string; sha256: string }[];
  failedAttemptId: string | null;
};

export type ExportIntakeResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ExportIntakeIssue[] };

export type IntakeUploadPost = { url: string; fields: Record<string, string> };
export type PreparedExportIntake =
  | {
      state: "staging";
      jobId: string;
      uploads: { name: string; contentType: string; post: IntakeUploadPost }[];
    }
  | { state: "known"; job: ExportIntakeJob };

type ExportIntakeRequest = { target: ExportIntakeBinding; requestId: string };
export type PrepareExportIntakeInput = ExportIntakeRequest & { manifest: ExportManifest };
export type QueueExportIntakeInput = ExportIntakeRequest & { jobId: string };
export type RetryExportIntakeInput = QueueExportIntakeInput & { failedAttemptId: string };

export type ExportIntakeAccess = {
  list: (
    target: ExportIntakeBinding,
    signal?: AbortSignal,
  ) => Promise<ExportIntakeResult<ExportIntakeJob[]>>;
  submit: (
    input: PrepareExportIntakeInput & { files: File[] },
  ) => Promise<ExportIntakeResult<ExportIntakeJob>>;
  retry: (input: RetryExportIntakeInput) => Promise<ExportIntakeResult<ExportIntakeJob>>;
};
