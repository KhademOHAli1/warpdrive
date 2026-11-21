import { createHash, randomUUID } from "node:crypto";
import { env } from "@/config/env";
import { validateDisplayFilename } from "@/features/files/keys";
import type { StorageClient } from "@/features/files/storage";
import { err, ok, type Result } from "@/types/result";
import { maxQualityEvidenceBytes } from "./contracts";

const formats = {
  csv: "text/csv",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
} as const;
const utf8 = new TextDecoder("utf-8", { fatal: true });

type EvidenceMetadata = { sizeBytes: number; contentType: string };
type StagedEvidence = EvidenceMetadata & { id: string; targetId: string; stagingKey: string };
export type EvidenceSeal = { objectKey: string; etag: string; sha256: string };
type EvidenceStorageResult<T> = Result<T, "evidence">;

function validSize(size: number) {
  return Number.isSafeInteger(size) && size > 0 && size <= maxQualityEvidenceBytes;
}

export function qualityEvidenceFile(raw: string, sizeBytes: number) {
  if (!validSize(sizeBytes) || sizeBytes > env.MAX_FILE_BYTES) return null;
  const validated = validateDisplayFilename(raw);
  if (!validated.ok) return null;
  const name = validated.value.trim();
  if (name.length === 0 || name.length > 180) return null;
  if (/[/\\<>:"|?*\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(name.normalize("NFKC"))) return null;
  const index = name.lastIndexOf(".");
  const suffix = name.slice(index + 1).toLowerCase();
  if (index < 1 || !Object.hasOwn(formats, suffix)) return null;
  return { name, contentType: formats[suffix as keyof typeof formats] };
}

function matchesContent(bytes: Buffer, contentType: string) {
  switch (contentType) {
    case "application/pdf":
      return bytes.subarray(0, 5).toString() === "%PDF-";
    case "image/png":
      return bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    case "image/jpeg":
      return bytes.subarray(0, 3).toString("hex") === "ffd8ff";
    case "text/csv":
    case "text/plain": {
      try {
        const content = utf8.decode(bytes);
        return content.trim().length > 0 && !/\p{Cc}/u.test(content.replace(/[\t\r\n]/g, ""));
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

function digest(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function removeUnusedEvidenceObject(storage: StorageClient, key: string) {
  try {
    await storage.deleteObject(key, AbortSignal.timeout(4000));
  } catch {
    // Unreferenced objects remain private if best-effort cleanup cannot run.
  }
}

async function storedBytes(
  storage: StorageClient,
  row: EvidenceMetadata,
  key: string,
  signal: AbortSignal,
  expectedEtag?: string,
): Promise<EvidenceStorageResult<Buffer>> {
  if (!validSize(row.sizeBytes)) return err("evidence");
  const head = await storage.headObject(key, signal);
  if (
    !head.ok ||
    head.value.size !== row.sizeBytes ||
    head.value.contentType !== row.contentType ||
    (expectedEtag !== undefined && head.value.etag !== expectedEtag)
  ) {
    return err("evidence");
  }
  const loaded = await storage.getObjectBytes(key, signal, row.sizeBytes);
  if (!loaded.ok || loaded.value.length !== row.sizeBytes) return err("evidence");
  return ok(loaded.value);
}

export async function sealQualityEvidenceUpload(
  storage: StorageClient,
  row: StagedEvidence,
  signal: AbortSignal,
): Promise<EvidenceStorageResult<EvidenceSeal>> {
  const loaded = await storedBytes(storage, row, row.stagingKey, signal);
  if (!loaded.ok || !matchesContent(loaded.value, row.contentType)) return err("evidence");
  // Keep the exact inspected bytes independent of later writes to the staging key.
  const bytes = Buffer.from(loaded.value);
  // Attempts have isolated keys so disposing of a losing attempt cannot delete the winner.
  const objectKey = `confirmed/inventory-quality-evidence/${row.targetId}/${row.id}/${randomUUID()}`;
  try {
    const written = await storage.putObjectBytes(objectKey, bytes, row.contentType, signal);
    if (written.ok) {
      const head = await storage.headObject(objectKey, signal);
      if (
        head.ok &&
        head.value.size === row.sizeBytes &&
        head.value.contentType === row.contentType &&
        head.value.etag.length > 0
      ) {
        return ok({ objectKey, etag: head.value.etag, sha256: digest(bytes) });
      }
    }
  } catch (error) {
    await removeUnusedEvidenceObject(storage, objectKey);
    throw error;
  }
  await removeUnusedEvidenceObject(storage, objectKey);
  return err("evidence");
}

export async function readSealedQualityEvidence(
  storage: StorageClient,
  row: EvidenceMetadata & EvidenceSeal,
  signal: AbortSignal,
): Promise<EvidenceStorageResult<Buffer>> {
  const loaded = await storedBytes(storage, row, row.objectKey, signal, row.etag);
  if (!loaded.ok || digest(loaded.value) !== row.sha256) return err("evidence");
  return ok(Buffer.from(loaded.value));
}
