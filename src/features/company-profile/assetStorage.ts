import { createHash } from "node:crypto";
import * as Minio from "minio";
import { env } from "@/config/env";
import { err, ok, type Result } from "@/types/result";
import { MAX_COMPANY_ASSET_BYTES } from "./assetSanitizer";
import { companyStorageCall, companyStorageTransport } from "./storageDeadline";

export interface CompanyAssetStorage {
  put(
    key: string,
    bytes: Buffer,
    signal: AbortSignal,
  ): Promise<Result<void, "storage_unavailable">>;
  read(
    key: string,
    size: number,
    digest: string,
    signal: AbortSignal,
  ): Promise<Result<Buffer, "storage_unavailable">>;
}
export class MinioCompanyAssetStorage implements CompanyAssetStorage {
  private readonly client: Minio.Client;
  constructor() {
    const url = new URL(env.MINIO_ENDPOINT);
    this.client = new Minio.Client({
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      useSSL: url.protocol === "https:",
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY,
      transport: companyStorageTransport(url.protocol === "https:"),
      retryOptions: { disableRetry: true },
    });
  }
  async put(
    key: string,
    bytes: Buffer,
    signal: AbortSignal,
  ): Promise<Result<void, "storage_unavailable">> {
    signal.throwIfAborted();
    if (!key.startsWith("company-assets/v1/") || bytes.length > MAX_COMPANY_ASSET_BYTES)
      return err("storage_unavailable");
    try {
      await companyStorageCall(signal, () =>
        this.client.putObject(env.MINIO_BUCKET, key, bytes, bytes.length, {
          "Content-Type": "image/png",
        }),
      );
      signal.throwIfAborted();
      return ok(undefined);
    } catch {
      signal.throwIfAborted();
      return err("storage_unavailable");
    }
  }
  async read(
    key: string,
    size: number,
    digest: string,
    signal: AbortSignal,
  ): Promise<Result<Buffer, "storage_unavailable">> {
    signal.throwIfAborted();
    if (!key.startsWith("company-assets/v1/") || size < 1 || size > MAX_COMPANY_ASSET_BYTES)
      return err("storage_unavailable");
    try {
      const stat = await companyStorageCall(signal, () =>
        this.client.statObject(env.MINIO_BUCKET, key),
      );
      signal.throwIfAborted();
      if (stat.size !== size) return err("storage_unavailable");
      const stream = await companyStorageCall(
        signal,
        () => this.client.getObject(env.MINIO_BUCKET, key),
        (late) => {
          late.destroy();
        },
      );
      const cancel = () => stream.destroy();
      signal.addEventListener("abort", cancel, { once: true });
      const parts: Buffer[] = [];
      let length = 0;
      try {
        for await (const chunk of stream) {
          signal.throwIfAborted();
          const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          length += part.length;
          if (length > size || length > MAX_COMPANY_ASSET_BYTES) {
            stream.destroy();
            return err("storage_unavailable");
          }
          parts.push(part);
        }
      } finally {
        signal.removeEventListener("abort", cancel);
        stream.destroy();
      }
      signal.throwIfAborted();
      const bytes = Buffer.concat(parts);
      return bytes.length === size && createHash("sha256").update(bytes).digest("hex") === digest
        ? ok(bytes)
        : err("storage_unavailable");
    } catch {
      signal.throwIfAborted();
      return err("storage_unavailable");
    }
  }
}
