import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const VERSION = "scrypt-v1";
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const DIGEST_LENGTH = VERSION.length + 2 + (SALT_BYTES + KEY_BYTES) * 2;
const digestFormat = /^scrypt-v1\$([0-9a-f]{32})\$([0-9a-f]{64})$/;
// The version fixes the work factor. Stored input cannot request more memory or work.
const work = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function parseDigest(value: unknown) {
  if (typeof value !== "string" || value.length !== DIGEST_LENGTH) return null;
  const match = digestFormat.exec(value);
  const salt = match?.[1];
  const digest = match?.[2];
  if (salt === undefined || digest === undefined) return null;
  return { salt: Buffer.from(salt, "hex"), digest: Buffer.from(digest, "hex") };
}

function deriveKey(apiKey: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(apiKey, salt, KEY_BYTES, work, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function createWebhookCredential() {
  const apiKey = randomBytes(KEY_BYTES).toString("base64url");
  const salt = randomBytes(SALT_BYTES);
  const digest = await deriveKey(apiKey, salt);
  return { apiKey, apiKeyHash: `${VERSION}$${salt.toString("hex")}$${digest.toString("hex")}` };
}

export function isWebhookCredentialDigest(value: unknown): boolean {
  return parseDigest(value) !== null;
}

export async function verifyWebhookCredential(apiKey: unknown, storedDigest: unknown) {
  if (typeof apiKey !== "string" || apiKey.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(apiKey))
    return false;
  const stored = parseDigest(storedDigest);
  if (stored === null) return false;
  return timingSafeEqual(stored.digest, await deriveKey(apiKey, stored.salt));
}
