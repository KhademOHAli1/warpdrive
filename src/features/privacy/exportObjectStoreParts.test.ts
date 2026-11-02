import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Client } from "minio";
import { expect, test, vi } from "vitest";
import { ExportMultipartSink } from "./exportObjectStoreParts";

function client() {
  return new Client({
    endPoint: "127.0.0.1",
    port: 1,
    useSSL: false,
    accessKey: "synthetic-access",
    secretKey: "synthetic-secret",
  });
}

test("C05: rejected part I/O rejects the writable pipeline instead of falsely finishing staging", async () => {
  const storage = client();
  const failing = vi
    .spyOn(storage, "uploadPart")
    .mockRejectedValue(new DOMException("PRIVATE-PROVIDER-ERROR", "NetworkError"));
  try {
    const abort = AbortSignal.timeout(1000);
    const sink = new ExportMultipartSink(
      storage,
      "synthetic-private",
      "synthetic-key",
      "synthetic-upload",
      1024,
      abort,
    );
    const error: unknown = await pipeline(Readable.from([Buffer.from("synthetic")]), sink, {
      signal: abort,
    }).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toMatchObject({
      id: "E_PRIVACY_002",
      message: "Privacy artifact storage upload failed",
    });
    expect(JSON.stringify(error)).not.toContain("PRIVATE-");
    expect(sink.failure).toBe("upload_failed");
    expect(sink.digest).toBeNull();
    expect(sink.writableFinished).toBe(false);
  } finally {
    failing.mockRestore();
  }
});

test("C08: quota rejection is a sanitized stream failure before any provider write", async () => {
  const storage = client();
  const writes = vi.spyOn(storage, "uploadPart");
  try {
    const abort = AbortSignal.timeout(1000);
    const sink = new ExportMultipartSink(
      storage,
      "synthetic-private",
      "synthetic-key",
      "synthetic-upload",
      1,
      abort,
    );
    await expect(
      pipeline(Readable.from([Buffer.from("too much")]), sink, { signal: abort }),
    ).rejects.toMatchObject({ id: "E_PRIVACY_003" });
    expect(writes).not.toHaveBeenCalled();
    expect(sink.failure).toBe("quota_exceeded");
    expect(sink.digest).toBeNull();
  } finally {
    writes.mockRestore();
  }
});
