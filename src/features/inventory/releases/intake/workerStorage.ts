import { createHash } from "node:crypto";
import type { StorageClient } from "@/features/files/storage";
import {
  releaseArtifactUploadSpec,
  verifyReleaseArtifactBytes,
  writeReleaseArtifactSeal,
} from "../artifacts";
import type { inventoryReleaseArtifacts } from "../schema";
import type { ExportIntakeIssue, ExportIntakeResult } from "./contracts";
import { exportSealKey, exportStagingKey } from "./objectKeys";
import type { ExportFileRow, ExportJobRow } from "./schema";

export type ReadyExportArtifact = typeof inventoryReleaseArtifacts.$inferInsert;

// The provider may continue its own I/O after the caller's deadline. Each
// attempted seal has an isolated key and is later reconciled from the ledger.
export async function awaitExportStorage<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let removeListener = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    const abort = () => reject(new DOMException("Release export storage deadline", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    removeListener = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    removeListener();
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileFailure(code: ExportIntakeIssue["code"], file: ExportFileRow) {
  return {
    ok: false,
    issues: [{ code, file: file.name }],
  } as const satisfies ExportIntakeResult<never>;
}

async function readExportFile(storage: StorageClient, file: ExportFileRow, signal: AbortSignal) {
  const spec = releaseArtifactUploadSpec(file.kind, file.name, file.sizeBytes);
  if (!spec.ok) return fileFailure(spec.error, file);
  if (file.contentType !== spec.value.contentType) return fileFailure("fileType", file);
  const objectKey = exportStagingKey(file.jobId, file.ordinal);
  const head = await storage.headObject(objectKey, signal);
  if (!head.ok) return fileFailure("temporary", file);
  if (head.value.size !== file.sizeBytes) return fileFailure("fileSize", file);
  if (head.value.contentType !== file.contentType) return fileFailure("fileType", file);
  const loaded = await storage.getObjectBytes(objectKey, signal, file.sizeBytes);
  if (!loaded.ok) return fileFailure("temporary", file);
  if (loaded.value.length !== file.sizeBytes) return fileFailure("fileSize", file);
  if (sha256(loaded.value) !== file.sha256) return fileFailure("hashMismatch", file);
  const verified = verifyReleaseArtifactBytes(file, loaded.value, signal);
  return verified.ok ? verified : fileFailure("fileType", file);
}

async function sealExportFile(
  storage: StorageClient,
  job: ExportJobRow,
  attemptId: string,
  file: ExportFileRow,
  signal: AbortSignal,
): Promise<ExportIntakeResult<ReadyExportArtifact>> {
  const verified = await readExportFile(storage, file, signal);
  if (!verified.ok) return verified;
  const objectKey = exportSealKey(job.releaseId, file.artifactId, attemptId);
  const sealed = await writeReleaseArtifactSeal(
    storage,
    { ...file, objectKey },
    verified.value,
    signal,
  );
  if (!sealed.ok) return fileFailure("temporary", file);
  const readBack = await storage.getObjectBytes(objectKey, signal, file.sizeBytes);
  if (
    !readBack.ok ||
    readBack.value.length !== file.sizeBytes ||
    sha256(readBack.value) !== file.sha256
  ) {
    return fileFailure("temporary", file);
  }
  if (job.submittedBy === null) return fileFailure("unavailable", file);
  return {
    ok: true,
    value: {
      ...sealed.value,
      id: file.artifactId,
      releaseId: job.releaseId,
      name: file.name,
      kind: file.kind,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      createdBy: job.submittedBy,
      state: "ready",
    },
  };
}

export async function sealExportFiles(
  storage: StorageClient,
  job: ExportJobRow,
  attemptId: string,
  files: readonly ExportFileRow[],
  signal: AbortSignal,
): Promise<ExportIntakeResult<ReadyExportArtifact[]>> {
  const artifacts: ReadyExportArtifact[] = [];
  for (const file of files) {
    signal.throwIfAborted();
    const sealed = await awaitExportStorage(
      sealExportFile(storage, job, attemptId, file, signal),
      signal,
    );
    if (!sealed.ok) return sealed;
    artifacts.push(sealed.value);
  }
  return { ok: true, value: artifacts };
}
