import { addAbortSignal } from "node:stream";
import { z } from "zod";
import { err, ok } from "@/types/result";
import { attemptRefSchema, exportObjectKey, objectRefInputSchema } from "./exportObjectStoreRefs";
import {
  exportStoreClient,
  missingStoreObject,
  storeErrorCode,
} from "./exportObjectStoreTransport";
import type { ExportObjectStore, ExportStoreConfig } from "./exportObjectStoreTypes";

const listedVersions = z.array(
  z.object({
    name: z.string(),
    versionId: z.string().min(1),
    isDeleteMarker: z.boolean().optional(),
  }),
);

export function exportObjectOperations(
  config: ExportStoreConfig,
): Pick<ExportObjectStore, "open" | "stat" | "remove" | "inspect"> {
  const stat: ExportObjectStore["stat"] = async (input, signal) => {
    signal.throwIfAborted();
    const ref = objectRefInputSchema.safeParse(input);
    if (!ref.success) return err("invalid_object_ref");
    try {
      const result = await exportStoreClient(config, signal).statObject(
        config.bucket,
        exportObjectKey(ref.data),
        { versionId: ref.data.versionId },
      );
      signal.throwIfAborted();
      return result.versionId === ref.data.versionId
        ? ok({ bytes: result.size, etag: result.etag })
        : err("store_unavailable");
    } catch (cause) {
      signal.throwIfAborted();
      return err(missingStoreObject(cause) ? "object_missing" : "store_unavailable");
    }
  };
  return {
    stat,
    open: async (input, signal) => {
      signal.throwIfAborted();
      const ref = objectRefInputSchema.safeParse(input);
      if (!ref.success) return err("invalid_object_ref");
      try {
        const stream = await exportStoreClient(config, signal).getObject(
          config.bucket,
          exportObjectKey(ref.data),
          { versionId: ref.data.versionId },
        );
        const observe = () => undefined;
        stream.on("error", observe);
        stream.once("close", () => stream.removeListener("error", observe));
        addAbortSignal(
          AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)]),
          stream,
        );
        if (signal.aborted) stream.destroy();
        signal.throwIfAborted();
        return ok(stream);
      } catch (cause) {
        signal.throwIfAborted();
        return err(missingStoreObject(cause) ? "object_missing" : "store_unavailable");
      }
    },
    remove: async (input, signal) => {
      signal.throwIfAborted();
      const ref = objectRefInputSchema.safeParse(input);
      if (!ref.success) return err("invalid_object_ref");
      try {
        await exportStoreClient(config, signal).removeObject(
          config.bucket,
          exportObjectKey(ref.data),
          { versionId: ref.data.versionId },
        );
        signal.throwIfAborted();
        const checked = await stat(ref.data, signal);
        return !checked.ok && checked.error === "object_missing"
          ? ok("absent_verified")
          : err("delete_uncertain");
      } catch (cause) {
        signal.throwIfAborted();
        return err(storeErrorCode(cause) === "AccessDenied" ? "delete_denied" : "delete_uncertain");
      }
    },
    inspect: async (input, signal) => {
      signal.throwIfAborted();
      const ref = attemptRefSchema.safeParse(input);
      if (!ref.success) return err("invalid_object_ref");
      try {
        const client = exportStoreClient(config, signal);
        const key = exportObjectKey(ref.data);
        const versions = await client.listObjectsQuery(config.bucket, key, "", {
          Delimiter: "",
          IncludeVersion: true,
          MaxKeys: 100,
        });
        const uploads = await client.listIncompleteUploadsQuery(config.bucket, key, "", "", "");
        signal.throwIfAborted();
        if (versions.isTruncated === true || uploads.isTruncated) return err("inspection_limit");
        const parsed = listedVersions.safeParse(versions.objects);
        if (!parsed.success) return err("store_unavailable");
        if (parsed.data.some((item) => item.versionId === "null"))
          return err("versioning_required");
        return ok({
          objects: parsed.data
            .filter((item) => item.name === key)
            .map((item) => ({
              ref: { ...ref.data, versionId: item.versionId },
              deleteMarker: item.isDeleteMarker === true,
            })),
          uploads: uploads.uploads
            .filter((item) => item.key === key)
            .map((item) => ({ ...ref.data, uploadId: item.uploadId })),
        });
      } catch {
        signal.throwIfAborted();
        return err("store_unavailable");
      }
    },
  };
}
