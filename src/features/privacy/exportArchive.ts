import { createHash } from "node:crypto";
import { Transform, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { pack } from "tar-stream";
import { err, ok, type Result } from "@/types/result";
import type { DisclosureManifest } from "./disclosureSchemas";
import { prepareExportArchive } from "./exportArchivePlan";
import { archiveAbortable, writeArchiveManifest, writeArchiveSource } from "./exportArchiveStreams";
import type {
  ArchiveOperation,
  PrivacyArchiveFailure,
  PrivacyArchiveReceipt,
  PrivacyArchiveSource,
} from "./exportArchiveTypes";

export type {
  PrivacyArchiveFailure,
  PrivacyArchiveReceipt,
  PrivacyArchiveSource,
} from "./exportArchiveTypes";

function closeArchiveSources(iterator: AsyncIterator<PrivacyArchiveSource>) {
  // Request cleanup without letting an abandoned producer prevent bounded cancellation.
  try {
    const closing = iterator.return?.();
    if (closing !== undefined) void Promise.resolve(closing).catch(() => undefined);
  } catch {
    /* The original failed result is retained. */
  }
}

async function produceArchive(
  archive: ReturnType<typeof pack>,
  entries: AsyncIterable<PrivacyArchiveSource>,
  plan: Extract<ReturnType<typeof prepareExportArchive>, { ok: true }>["value"],
  operation: ArchiveOperation,
) {
  const iterator = entries[Symbol.asyncIterator]();
  const seen = new Set<string>();
  let done = false;
  try {
    for (;;) {
      const yielded = await archiveAbortable(Promise.resolve(iterator.next()), operation.signal);
      operation.signal.throwIfAborted();
      if (!yielded.ok) return yielded;
      const next = yielded.value;
      if (next.done === true) {
        done = true;
        break;
      }
      const source = next.value;
      const path = source.path;
      const expected = plan.expected.get(path);
      if (expected === undefined) return err("entry_unapproved" as const);
      if (seen.has(path)) return err("entry_duplicate" as const);
      seen.add(path);
      const written = await writeArchiveSource(archive, path, source, expected, operation);
      if (!written.ok) return written;
    }
    if (seen.size !== plan.expected.size) return err("entry_missing" as const);
    await writeArchiveManifest(archive, plan.manifestBytes, operation);
    archive.finalize();
    return ok(true);
  } finally {
    if (!done) closeArchiveSources(iterator);
  }
}

// This receipt attests codec output only. Storage completion, authority and publication remain caller gates.
export async function writePrivacyExportArchive(
  manifest: DisclosureManifest,
  entries: AsyncIterable<PrivacyArchiveSource>,
  privateSink: Writable,
  signal: AbortSignal,
): Promise<Result<PrivacyArchiveReceipt, PrivacyArchiveFailure>> {
  signal.throwIfAborted();
  const prepared = prepareExportArchive(manifest, signal);
  if (!prepared.ok) return prepared;
  const controller = new AbortController();
  const state: { failure: PrivacyArchiveFailure | null } = { failure: null };
  const operation: ArchiveOperation = {
    signal: AbortSignal.any([signal, controller.signal]),
    failure: () => state.failure,
    fail: (code) => {
      state.failure ??= code;
      controller.abort();
    },
  };
  const archive = pack();
  const gzip = createGzip();
  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const sinkFailed = () => operation.fail("archive_write_failed");
  privateSink.once("error", sinkFailed);
  const output = pipeline(archive, gzip, meter, privateSink, { signal: operation.signal }).then(
    () => true,
    () => {
      operation.fail("archive_write_failed");
      return false;
    },
  );
  try {
    const produced = await produceArchive(archive, entries, prepared.value, operation);
    if (!produced.ok) operation.fail(produced.error);
    await output;
    signal.throwIfAborted();
    if (state.failure !== null) return err(state.failure);
    return ok({
      format: "tar.gz",
      sha256: hash.digest("hex"),
      bytes,
      files: prepared.value.expected.size,
    });
  } catch {
    operation.fail("source_read_failed");
    await output;
    signal.throwIfAborted();
    return err(state.failure ?? "source_read_failed");
  } finally {
    privateSink.removeListener("error", sinkFailed);
    archive.destroy();
    gzip.destroy();
    meter.destroy();
    if (state.failure !== null || signal.aborted) privateSink.destroy();
  }
}
