import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import type { z } from "zod";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";

const key = Buffer.from(
  hkdfSync(
    "sha256",
    Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64"),
    "warpdrive-company",
    "private-record-v1",
    32,
  ),
);
export function privateFingerprint(value: unknown): string {
  return createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
}
export function sealCompany(value: unknown, context: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`company:v1:${context}`));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString("base64");
}
export function openCompany<T>(packed: string, context: string, schema: z.ZodType<T>): T {
  try {
    const bytes = Buffer.from(packed, "base64");
    if (bytes.length < 29)
      throw new AppError(ERROR_IDS.COMPANY_WRITE_FAILED, "Company record is unreadable");
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(`company:v1:${context}`));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const parsed: unknown = JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"),
    );
    return schema.parse(parsed);
  } catch {
    // Corrupt stored ciphertext is an invariant failure, never a partial fallback.
    throw new AppError(ERROR_IDS.COMPANY_WRITE_FAILED, "Company record is unreadable");
  }
}
