import { createHash } from "node:crypto";
import { addAbortSignal, Writable } from "node:stream";
import type { Client } from "minio";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { ExportStoreFailure } from "./exportObjectStoreTypes";

export const EXPORT_PART_BYTES = 5 * 1024 * 1024;

// A single bounded part is retained. Completing the writable never completes S3.
export class ExportMultipartSink extends Writable {
  readonly parts: { part: number; etag: string }[] = [];
  failure: ExportStoreFailure | null = null;
  digest: { bytes: number; sha256: string } | null = null;
  private readonly buffer = Buffer.allocUnsafe(EXPORT_PART_BYTES);
  private readonly hash = createHash("sha256");
  private used = 0;
  private bytes = 0;
  constructor(
    private readonly client: Client,
    private readonly bucket: string,
    private readonly key: string,
    private readonly uploadId: string,
    private readonly maxBytes: number,
    private readonly signal: AbortSignal,
  ) {
    super({ highWaterMark: 64 * 1024 });
    const observe = () => undefined;
    this.on("error", observe);
    this.once("close", () => this.removeListener("error", observe));
    addAbortSignal(signal, this);
  }
  assertActive() {
    this.signal.throwIfAborted();
  }
  private async flushPart() {
    if (this.used === 0) return;
    this.signal.throwIfAborted();
    if (this.parts.length >= 10_000) {
      this.failure = "quota_exceeded";
      return;
    }
    const payload = this.buffer.subarray(0, this.used);
    this.hash.update(payload);
    const part = await this.client.uploadPart(
      {
        bucketName: this.bucket,
        objectName: this.key,
        uploadID: encodeURIComponent(this.uploadId),
        partNumber: this.parts.length + 1,
        headers: {
          "Content-Length": payload.length,
          "Content-MD5": createHash("md5").update(payload).digest("base64"),
        },
      },
      payload,
    );
    if (part.etag.length === 0) {
      this.failure = "upload_failed";
      return;
    }
    this.parts.push({ part: this.parts.length + 1, etag: part.etag });
    this.used = 0;
  }
  private async consume(chunk: Buffer) {
    this.signal.throwIfAborted();
    if (this.bytes + chunk.length > this.maxBytes) {
      this.failure = "quota_exceeded";
      return;
    }
    this.bytes += chunk.length;
    let offset = 0;
    while (offset < chunk.length && this.failure === null) {
      const take = Math.min(chunk.length - offset, EXPORT_PART_BYTES - this.used);
      chunk.copy(this.buffer, this.used, offset, offset + take);
      this.used += take;
      offset += take;
      if (this.used === EXPORT_PART_BYTES) await this.flushPart();
    }
  }
  private completeWrite(task: Promise<void>, callback: (error?: Error | null) => void) {
    void task.then(
      () => {
        callback(this.failure === null ? undefined : this.streamFailure());
      },
      () => {
        this.failure ??= "upload_failed";
        callback(this.streamFailure());
      },
    );
  }
  private streamFailure(): AppError {
    return this.failure === "quota_exceeded"
      ? new AppError(ERROR_IDS.PRIVACY_EXPORT_QUOTA, "Privacy artifact storage quota exceeded")
      : new AppError(
          ERROR_IDS.PRIVACY_EXPORT_STREAM_FAILED,
          "Privacy artifact storage upload failed",
        );
  }
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.completeWrite(this.consume(chunk), callback);
  }
  override _final(callback: (error?: Error | null) => void) {
    this.completeWrite(
      this.flushPart().then(() => {
        if (this.failure === null)
          this.digest = { bytes: this.bytes, sha256: this.hash.digest("hex") };
      }),
      callback,
    );
  }
}
