import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";

const HASH_PREFIX = "wd-recovery-v1:";
const HASH_PATTERN = /^wd-recovery-v1:[A-Za-z0-9_-]{43}$/;
const codesSchema = z.array(z.string());

export function hashRecoveryInput(raw: string): string {
  // Always hash input, including a copied digest, so a database read is not a recovery factor.
  return `${HASH_PREFIX}${createHash("sha256").update(raw).digest("base64url")}`;
}

function readCodes(value: string): string[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new AppError(ERROR_IDS.AUTH_RECOVERY_STORAGE_INVALID, "Invalid recovery-code record");
  }
  const parsed = codesSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new AppError(ERROR_IDS.AUTH_RECOVERY_STORAGE_INVALID, "Invalid recovery-code record");
  }
  return parsed.data;
}

/**
 * Better Auth's backup-code serializer also rewrites the remaining codes after redemption.
 * Keep those digests stable; freshly issued codes are returned separately by the plugin.
 * The verify-backup-code before hook must always apply hashRecoveryInput to submitted input.
 */
export function createHashedBackupCodeStorage(): {
  encrypt: (codes: string) => Promise<string>;
  decrypt: (record: string) => Promise<string>;
} {
  return {
    encrypt: (value) =>
      Promise.resolve().then(() =>
        JSON.stringify(
          readCodes(value).map((code) =>
            HASH_PATTERN.test(code) ? code : hashRecoveryInput(code),
          ),
        ),
      ),
    decrypt: (value) =>
      Promise.resolve().then(() => {
        const codes = readCodes(value);
        if (!codes.every((code) => HASH_PATTERN.test(code))) {
          throw new AppError(
            ERROR_IDS.AUTH_RECOVERY_STORAGE_INVALID,
            "Unhashed recovery-code record",
          );
        }
        return JSON.stringify(codes);
      }),
  };
}
