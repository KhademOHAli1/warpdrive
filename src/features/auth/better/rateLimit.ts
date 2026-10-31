import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { lt, lte, or, sql } from "drizzle-orm";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { authRateLimits } from "@/db/schema";

type TrustedProxyHeader = "none" | "x-forwarded-for" | "x-real-ip" | "cf-connecting-ip";
export const AUTH_RATE_LIMITS = {
  windowMs: 60_000,
  sensitiveAttempts: 20,
  readRequests: 200,
  unknownIpRequests: 200,
  retentionMs: 24 * 60 * 60 * 1000,
} as const;

const READ_PATHS = new Set([
  "/get-session",
  "/list-accounts",
  "/passkey/list-user-passkeys",
  "/security/snapshot",
  "/snapshot",
  "/security",
]);

function normalizedIpv6(value: string): string | null {
  try {
    const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const halves = canonical.split("::");
    const leftText = halves[0] ?? "";
    const rightText = halves[1] ?? "";
    const left = leftText !== "" ? leftText.split(":") : [];
    const right = rightText !== "" ? rightText.split(":") : [];
    const blocks =
      halves.length === 2
        ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]
        : left;
    if (blocks.length !== 8) return null;
    const numbers = blocks.map((block) => Number.parseInt(block, 16));
    if (numbers.slice(0, 5).every((block) => block === 0) && numbers[5] === 0xffff) {
      const high = numbers[6] ?? 0;
      const low = numbers[7] ?? 0;
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
    return `${numbers
      .slice(0, 4)
      .map((block) => block.toString(16))
      .join(":")}::/64`;
  } catch {
    return null;
  }
}

export function readAuthRateLimitIp(
  headers: Headers,
  trustedHeader: TrustedProxyHeader,
): string | null {
  if (trustedHeader === "none") return null;
  const value = headers.get(trustedHeader)?.trim() ?? "";
  // A selected proxy must overwrite its header with one literal client address. Never guess
  // which element of an appended, potentially attacker-controlled forwarding chain is trusted.
  if (value.length > 64 || value.includes(",")) return null;
  const family = isIP(value);
  if (family === 4) return value;
  return family === 6 ? normalizedIpv6(value) : null;
}

function bucketKey(kind: string, identity: string): string {
  return createHash("sha256").update(`warpdrive-auth-v1|${kind}|${identity}`).digest("base64url");
}

async function takeBucket(
  db: Db,
  key: string,
  limit: number,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const now = Date.now();
  const cutoff = now - AUTH_RATE_LIMITS.windowMs;
  const rows = await db
    .insert(authRateLimits)
    .values({ key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: authRateLimits.key,
      set: {
        count: sql`CASE WHEN ${authRateLimits.lastRequest} <= ${cutoff} THEN 1 ELSE ${authRateLimits.count} + 1 END`,
        lastRequest: sql`CASE WHEN ${authRateLimits.lastRequest} <= ${cutoff} THEN ${now} ELSE ${authRateLimits.lastRequest} END`,
      },
      setWhere: or(lte(authRateLimits.lastRequest, cutoff), lt(authRateLimits.count, limit)),
    })
    .returning({ id: authRateLimits.id });
  signal.throwIfAborted();
  return rows.length === 1;
}

export function createAuthRateLimiter(trustedHeader: TrustedProxyHeader) {
  return async (
    db: Db,
    headers: Headers,
    path: string,
    subject: string | undefined,
    signal: AbortSignal,
  ): Promise<boolean> => {
    signal.throwIfAborted();
    const ip = readAuthRateLimitIp(headers, trustedHeader);
    const isRead = READ_PATHS.has(path.split("?")[0] ?? path);
    const limit = isRead ? AUTH_RATE_LIMITS.readRequests : AUTH_RATE_LIMITS.sensitiveAttempts;
    const category = isRead ? "read" : "sensitive";
    // A request denied by a later bucket still consumes earlier budgets, so repeated denied
    // account attempts cannot avoid the IP/global abuse limit. Every increment is atomic in PG.
    if (ip === null) {
      if (
        !(await takeBucket(
          db,
          bucketKey("unknown-ip", "global"),
          AUTH_RATE_LIMITS.unknownIpRequests,
          signal,
        ))
      )
        return false;
    } else if (!(await takeBucket(db, bucketKey(`${category}:ip`, ip), limit, signal)))
      return false;
    const identity = subject?.trim().toLowerCase();
    if (
      identity !== undefined &&
      identity.length > 0 &&
      !(await takeBucket(db, bucketKey(`${category}:subject`, identity), limit, signal))
    )
      return false;
    return true;
  };
}

export function enforceAuthRateLimit(
  db: Db,
  headers: Headers,
  path: string,
  subject: string | undefined,
  signal: AbortSignal,
): Promise<boolean> {
  return createAuthRateLimiter(env.AUTH_TRUSTED_PROXY_HEADER)(db, headers, path, subject, signal);
}

export async function pruneAuthRateLimits(db: Db, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await db
    .delete(authRateLimits)
    .where(lt(authRateLimits.lastRequest, Date.now() - AUTH_RATE_LIMITS.retentionMs));
  signal.throwIfAborted();
}
