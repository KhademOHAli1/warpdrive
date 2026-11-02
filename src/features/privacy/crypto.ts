import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { env } from "@/config/env";
import { AppError } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";

type PrivacyContext = {
  caseId: string;
  purpose: "intake" | "decision" | "identity" | "job" | "policy";
};
const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY = Buffer.from(
  hkdfSync(
    "sha256",
    Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64"),
    "warpdrive-privacy",
    "evidence-v1",
    32,
  ),
);
const aad = (context: PrivacyContext) =>
  Buffer.from(JSON.stringify(["warpdrive-privacy", VERSION, context.caseId, context.purpose]));

export function fingerprintPrivacy(plaintext: string, context: PrivacyContext): string {
  return createHmac("sha256", KEY)
    .update("replay-fingerprint")
    .update(aad(context))
    .update(plaintext)
    .digest("base64url");
}

export function encryptPrivacy(plaintext: string, context: PrivacyContext): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", KEY, nonce);
  cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), nonce, cipher.getAuthTag(), ciphertext]);
}

export function decryptPrivacy(packed: Buffer, context: PrivacyContext): Result<string, AppError> {
  const failure = () =>
    err(new AppError("E_PRIVACY_001", "Privacy evidence cannot be authenticated"));
  if (packed.length < 1 + NONCE_BYTES + TAG_BYTES || packed[0] !== VERSION) return failure();
  try {
    const decipher = createDecipheriv("aes-256-gcm", KEY, packed.subarray(1, 1 + NONCE_BYTES));
    decipher.setAAD(aad(context));
    decipher.setAuthTag(packed.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES));
    return ok(
      Buffer.concat([
        decipher.update(packed.subarray(1 + NONCE_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    return failure();
  }
}
