import { randomUUID } from "node:crypto";
import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import { exportObjectOperations } from "./exportObjectStoreObjects";
import { EXPORT_PART_BYTES, ExportMultipartSink } from "./exportObjectStoreParts";
import {
  attemptRefSchema,
  exportObjectKey,
  exportObjectVersionSchema,
  objectStoreConfigSchema,
  uploadRefSchema,
} from "./exportObjectStoreRefs";
import { exportStoreClient, storeErrorCode } from "./exportObjectStoreTransport";
import type {
  ExportObjectStore,
  ExportObjectUpload,
  ExportStoreConfig,
  ExportStoredObject,
  ExportUploadRef,
} from "./exportObjectStoreTypes";

export type {
  ExportAttemptRef,
  ExportObjectRef,
  ExportObjectStore,
  ExportObjectUpload,
  ExportStoreConfig,
  ExportStoredObject,
  ExportStoreFailure,
  ExportUploadRef,
} from "./exportObjectStoreTypes";

const receiptSchema = z
  .object({
    format: z.literal("tar.gz"),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    files: z.number().int().min(0).max(10_000),
  })
  .strict();
const limitSchema = z
  .object({
    maxBytes: z
      .number()
      .int()
      .min(1)
      .max(EXPORT_PART_BYTES * 10_000),
  })
  .strict();

function uploadCompletion(
  config: ExportStoreConfig,
  ref: ExportUploadRef,
  sink: ExportMultipartSink,
  attemptSignal: AbortSignal,
): ExportObjectUpload["complete"] {
  const state: { started: boolean; completed: ExportStoredObject | null } = {
    started: false,
    completed: null,
  };
  return async (input, completionSignal) => {
    const signal = AbortSignal.any([attemptSignal, completionSignal]);
    signal.throwIfAborted();
    sink.assertActive();
    if (sink.failure !== null) return err(sink.failure);
    if (!sink.writableFinished) return err("upload_not_finished");
    const receipt = receiptSchema.safeParse(input);
    if (
      !receipt.success ||
      sink.digest === null ||
      sink.digest.bytes !== receipt.data.bytes ||
      sink.digest.sha256 !== receipt.data.sha256
    )
      return err("receipt_mismatch");
    if (state.completed !== null) return ok(state.completed);
    if (state.started) return err("completion_uncertain");
    state.started = true;
    try {
      const completed = await exportStoreClient(config, signal).completeMultipartUpload(
        config.bucket,
        exportObjectKey(ref),
        ref.uploadId,
        sink.parts,
      );
      signal.throwIfAborted();
      const version = exportObjectVersionSchema.safeParse(completed.versionId);
      if (!version.success) return err("completion_uncertain");
      const object = Object.freeze({
        artifactId: ref.artifactId,
        attemptId: ref.attemptId,
        versionId: version.data,
        bytes: sink.digest.bytes,
        sha256: sink.digest.sha256,
      });
      const checked = await exportObjectOperations(config).stat(
        {
          artifactId: object.artifactId,
          attemptId: object.attemptId,
          versionId: object.versionId,
        },
        signal,
      );
      signal.throwIfAborted();
      if (!checked.ok || checked.value.bytes !== object.bytes) return err("completion_uncertain");
      state.completed = object;
      return ok(object);
    } catch {
      signal.throwIfAborted();
      return err("completion_uncertain");
    }
  };
}

// Internal storage only: no authority, publication, bucket provisioning or delivery grants.
export function createExportObjectStore(
  input: ExportStoreConfig,
): Result<ExportObjectStore, "invalid_store_config"> {
  const parsed = objectStoreConfigSchema.safeParse(input);
  if (!parsed.success) return err("invalid_store_config");
  const config = Object.freeze(parsed.data);
  const live = new Map<string, { controller: AbortController; sink: ExportMultipartSink }>();
  const operations = exportObjectOperations(config);
  return ok({
    ...operations,
    allocate: () => Object.freeze({ artifactId: randomUUID(), attemptId: randomUUID() }),
    begin: async (inputRef, inputLimits, signal) => {
      signal.throwIfAborted();
      const ref = attemptRefSchema.safeParse(inputRef);
      if (!ref.success) return err("invalid_object_ref");
      const limits = limitSchema.safeParse(inputLimits);
      if (!limits.success) return err("invalid_upload_limit");
      let initiating = false;
      try {
        const client = exportStoreClient(config, signal);
        const versioning = await client.getBucketVersioning(config.bucket);
        signal.throwIfAborted();
        if (versioning.Status !== "Enabled") return err("versioning_required");
        initiating = true;
        const uploadId = await client.initiateNewMultipartUpload(
          config.bucket,
          exportObjectKey(ref.data),
          { "Content-Type": "application/gzip", "Cache-Control": "no-store" },
        );
        signal.throwIfAborted();
        const uploadRef = Object.freeze({ ...ref.data, uploadId });
        const controller = new AbortController();
        const combined = AbortSignal.any([signal, controller.signal]);
        const sink = new ExportMultipartSink(
          exportStoreClient(config, combined),
          config.bucket,
          exportObjectKey(ref.data),
          uploadId,
          limits.data.maxBytes,
          combined,
        );
        live.set(uploadId, { controller, sink });
        sink.once("close", () => live.delete(uploadId));
        return ok({
          ref: uploadRef,
          sink,
          complete: uploadCompletion(config, uploadRef, sink, combined),
        });
      } catch {
        signal.throwIfAborted();
        return err(initiating ? "begin_uncertain" : "store_unavailable");
      }
    },
    abort: async (inputRef, signal) => {
      signal.throwIfAborted();
      const ref = uploadRefSchema.safeParse(inputRef);
      if (!ref.success) return err("invalid_object_ref");
      const active = live.get(ref.data.uploadId);
      active?.controller.abort();
      active?.sink.destroy();
      live.delete(ref.data.uploadId);
      try {
        const client = exportStoreClient(config, signal);
        try {
          await client.abortMultipartUpload(
            config.bucket,
            exportObjectKey(ref.data),
            encodeURIComponent(ref.data.uploadId),
          );
        } catch (cause) {
          if (storeErrorCode(cause) !== "NoSuchUpload") throw cause;
        }
        const inspected = await operations.inspect(
          { artifactId: ref.data.artifactId, attemptId: ref.data.attemptId },
          signal,
        );
        signal.throwIfAborted();
        return inspected.ok &&
          !inspected.value.uploads.some((item) => item.uploadId === ref.data.uploadId)
          ? ok("upload_absent_verified")
          : err("abort_uncertain");
      } catch {
        signal.throwIfAborted();
        return err("abort_uncertain");
      }
    },
  });
}
