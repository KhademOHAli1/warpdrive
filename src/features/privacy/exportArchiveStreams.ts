import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Pack } from "tar-stream";
import { err, ok, type Result } from "@/types/result";
import type {
  ArchiveOperation,
  ExpectedArchiveEntry,
  PrivacyArchiveSource,
} from "./exportArchiveTypes";

function destroyArchiveSource(stream: Readable) {
  if (stream.closed) return;
  const observeError = () => undefined;
  const cleanup = () => {
    stream.removeListener("error", observeError);
    stream.removeListener("close", cleanup);
  };
  // Destruction can fail after the caller has received its cancellation result.
  // Keep those errors observed until close, then release this cleanup observer.
  stream.on("error", observeError);
  stream.once("close", cleanup);
  stream.destroy();
}

// An adapter ignoring cancellation cannot pin the codec or leak a stream that resolves after abort.
export function archiveAbortable<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  late?: (value: T) => void,
): Promise<Result<T, "source_read_failed">> {
  return new Promise((resolve) => {
    let settled = false;
    let abandoned = false;
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      if (settled) return;
      settled = true;
      abandoned = true;
      cleanup();
      resolve(err("source_read_failed"));
    };
    signal.addEventListener("abort", abort, { once: true });
    void pending
      .then(
        (value) => {
          if (abandoned) {
            late?.(value);
            return;
          }
          if (settled) return;
          settled = true;
          cleanup();
          resolve(ok(value));
        },
        () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(err("source_read_failed"));
        },
      )
      .catch(() => undefined);
    if (signal.aborted) abort();
  });
}

function verifier(expected: ExpectedArchiveEntry, operation: ArchiveOperation) {
  const hash = createHash("sha256");
  let bytes = 0;
  return new Transform({
    writableObjectMode: true,
    writableHighWaterMark: 1,
    transform(chunk: unknown, _encoding, callback) {
      if (!(chunk instanceof Uint8Array)) {
        operation.fail("source_read_failed");
        callback();
        return;
      }
      bytes += chunk.byteLength;
      if (bytes > expected.bytes) {
        operation.fail("entry_size_mismatch");
        callback();
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      if (bytes !== expected.bytes) operation.fail("entry_size_mismatch");
      else if (hash.digest("hex") !== expected.sha256) operation.fail("entry_checksum_mismatch");
      callback();
    },
  });
}

export async function writeArchiveSource(
  pack: Pack,
  path: string,
  source: PrivacyArchiveSource,
  expected: ExpectedArchiveEntry,
  operation: ArchiveOperation,
) {
  const opening = await archiveAbortable(
    source.open(operation.signal),
    operation.signal,
    (result) => {
      if (result.ok) destroyArchiveSource(result.value);
    },
  );
  if (!opening.ok) return opening;
  const opened = opening.value;
  if (!opened.ok) return err("source_unavailable" as const);
  const stream = opened.value;
  const sourceFailed = () => operation.fail("source_read_failed");
  stream.once("error", sourceFailed);
  try {
    operation.signal.throwIfAborted();
    const entry = pack.entry({
      name: path,
      size: expected.bytes,
      type: "file",
      mode: 0o600,
      uid: 0,
      gid: 0,
      mtime: new Date(0),
    });
    await pipeline(stream, verifier(expected, operation), entry, { signal: operation.signal });
    operation.signal.throwIfAborted();
    return ok(true);
  } catch {
    return err(operation.failure() ?? "source_read_failed");
  } finally {
    stream.removeListener("error", sourceFailed);
    destroyArchiveSource(stream);
  }
}

export async function writeArchiveManifest(
  pack: Pack,
  manifest: Buffer,
  operation: ArchiveOperation,
) {
  const entry = pack.entry({
    name: "manifest.json",
    size: manifest.length,
    type: "file",
    mode: 0o600,
    uid: 0,
    gid: 0,
    mtime: new Date(0),
  });
  await pipeline(Readable.from([manifest]), entry, { signal: operation.signal });
  operation.signal.throwIfAborted();
}
