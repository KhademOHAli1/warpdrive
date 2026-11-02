import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_JWT_ALGORITHM,
  REFRESH_TOKEN_TTL_MS,
} from "@/constants/oauth";
import type { Db } from "@/db/client";
import { oauthAccessTokens, oauthAuthCodes, oauthRefreshTokens } from "@/db/schema/oauth";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { err, ok, type Result } from "@/types/result";
import { sha256Base64Url } from "./pkce";

interface TokenOwner {
  clientId: string;
  userId: string;
}

interface VerifiedAccessToken {
  userId: string;
  jti: string;
  clientId: string;
  expiresAt: Date;
}

interface RotatedRefreshToken extends TokenOwner {
  refreshToken: string;
}

const signingKey = Buffer.from(env.OAUTH_SIGNING_KEY, "base64");

function tokenError(message: string): AppError {
  return new AppError(ERROR_IDS.OAUTH_TOKEN_REVOKED, message, {});
}

export async function issueAccessToken(
  db: Db,
  owner: TokenOwner,
  signal: AbortSignal,
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  signal.throwIfAborted();
  const jti = randomUUID();
  const issuedAtSeconds = Math.floor(Date.now() / 1_000);
  const expiresAt = new Date((issuedAtSeconds + ACCESS_TOKEN_TTL_SECONDS) * 1_000);
  const token = await new SignJWT({ clientId: owner.clientId })
    .setProtectedHeader({ alg: OAUTH_JWT_ALGORITHM })
    .setSubject(owner.userId)
    .setJti(jti)
    .setIssuer(env.BASE_URL)
    .setAudience(`${env.BASE_URL.replace(/\/$/, "")}/api/mcp`)
    .setIssuedAt(issuedAtSeconds)
    .setExpirationTime(issuedAtSeconds + ACCESS_TOKEN_TTL_SECONDS)
    .sign(signingKey);
  signal.throwIfAborted();
  await db.insert(oauthAccessTokens).values({ jti, ...owner, expiresAt });
  signal.throwIfAborted();
  return { token, jti, expiresAt };
}

export async function verifyAccessToken(
  db: Db,
  token: string,
  signal: AbortSignal,
): Promise<Result<VerifiedAccessToken, AppError>> {
  signal.throwIfAborted();
  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    ({ payload } = await jwtVerify(token, signingKey, {
      algorithms: [OAUTH_JWT_ALGORITHM],
      issuer: env.BASE_URL,
      audience: `${env.BASE_URL.replace(/\/$/, "")}/api/mcp`,
    }));
  } catch {
    return err(tokenError("access token is invalid or expired"));
  }
  signal.throwIfAborted();
  if (typeof payload.sub !== "string" || typeof payload.jti !== "string") {
    return err(tokenError("access token claims are invalid"));
  }

  const [row] = await db
    .select()
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.jti, payload.jti));
  signal.throwIfAborted();
  if (
    row === undefined ||
    row.revokedAt !== null ||
    row.expiresAt <= new Date() ||
    row.userId !== payload.sub
  ) {
    return err(tokenError("access token is revoked or expired"));
  }

  await db
    .update(oauthAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(oauthAccessTokens.jti, row.jti));
  signal.throwIfAborted();
  return ok({
    userId: row.userId,
    jti: row.jti,
    clientId: row.clientId,
    expiresAt: row.expiresAt,
  });
}

export async function issueRefreshToken(
  db: Db,
  owner: TokenOwner,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const token = randomBytes(32).toString("base64url");
  await db.insert(oauthRefreshTokens).values({
    tokenHash: sha256Base64Url(token),
    ...owner,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  signal.throwIfAborted();
  return token;
}

function invalidRefreshGrant(message = "refresh token is invalid"): AppError {
  return new AppError(ERROR_IDS.OAUTH_INVALID_GRANT, message, {});
}

async function containRefreshFamily(
  db: Db,
  first: typeof oauthRefreshTokens.$inferSelect,
  signal: AbortSignal,
): Promise<Result<void, AppError>> {
  const seen = new Set<string>();
  const hashes: string[] = [];
  let current = first;
  for (;;) {
    signal.throwIfAborted();
    if (
      current.clientId !== first.clientId ||
      current.userId !== first.userId ||
      seen.has(current.tokenHash) ||
      (current.rotatedTo !== null && current.revokedAt === null)
    ) {
      return err(invalidRefreshGrant("refresh token rotation chain is inconsistent"));
    }
    seen.add(current.tokenHash);
    hashes.push(current.tokenHash);
    if (current.rotatedTo === null) break;
    // Expired or already-revoked ancestors still identify the same successor chain.
    const [next] = await db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, current.rotatedTo))
      .limit(1);
    signal.throwIfAborted();
    if (next === undefined) {
      return err(invalidRefreshGrant("refresh token rotation chain is incomplete"));
    }
    current = next;
  }

  // Validate the complete chain before any update; corrupt links cannot cause a partial sweep.
  await db
    .update(oauthRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        inArray(oauthRefreshTokens.tokenHash, hashes),
        eq(oauthRefreshTokens.clientId, first.clientId),
        eq(oauthRefreshTokens.userId, first.userId),
        isNull(oauthRefreshTokens.revokedAt),
      ),
    );
  signal.throwIfAborted();
  return ok(undefined);
}

export async function rotateRefreshToken(
  db: Db,
  token: string,
  signal: AbortSignal,
  expectedClientId?: string,
): Promise<Result<RotatedRefreshToken, AppError>> {
  signal.throwIfAborted();
  const tokenHash = sha256Base64Url(token);
  const refreshToken = randomBytes(32).toString("base64url");
  const successorHash = sha256Base64Url(refreshToken);
  const owner = await db.transaction(async (tx): Promise<Result<TokenOwner, AppError>> => {
    await lockMcpGrants(tx, signal);
    const [presented] = await tx
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, tokenHash))
      .limit(1);
    signal.throwIfAborted();
    if (
      presented === undefined ||
      (expectedClientId !== undefined && presented.clientId !== expectedClientId)
    ) {
      return err(invalidRefreshGrant());
    }
    if (presented.revokedAt !== null) {
      if (presented.rotatedTo !== null) {
        const contained = await containRefreshFamily(tx, presented, signal);
        if (!contained.ok) return contained;
      }
      // Return a denial so the transaction commits containment instead of rolling it back.
      return err(invalidRefreshGrant());
    }
    if (presented.rotatedTo !== null) {
      return err(invalidRefreshGrant("refresh token rotation chain is inconsistent"));
    }
    const [claimed] = await tx
      .update(oauthRefreshTokens)
      .set({ revokedAt: new Date(), rotatedTo: successorHash })
      .where(
        and(
          eq(oauthRefreshTokens.tokenHash, tokenHash),
          eq(oauthRefreshTokens.clientId, presented.clientId),
          eq(oauthRefreshTokens.userId, presented.userId),
          isNull(oauthRefreshTokens.revokedAt),
          gt(oauthRefreshTokens.expiresAt, new Date()),
        ),
      )
      .returning({ clientId: oauthRefreshTokens.clientId, userId: oauthRefreshTokens.userId });
    signal.throwIfAborted();
    if (claimed === undefined) return err(invalidRefreshGrant());
    await tx.insert(oauthRefreshTokens).values({
      tokenHash: successorHash,
      ...claimed,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
    signal.throwIfAborted();
    return ok(claimed);
  });
  signal.throwIfAborted();
  if (!owner.ok) return owner;
  return ok({ ...owner.value, refreshToken });
}

export async function revokeAllForClientUser(
  db: Db,
  clientId: string,
  userId: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await db.transaction(async (tx) => {
    await lockMcpGrants(tx, signal);
    const revokedAt = new Date();
    await tx
      .update(oauthAccessTokens)
      .set({ revokedAt })
      .where(
        and(
          eq(oauthAccessTokens.clientId, clientId),
          eq(oauthAccessTokens.userId, userId),
          isNull(oauthAccessTokens.revokedAt),
        ),
      );
    signal.throwIfAborted();
    await tx
      .update(oauthRefreshTokens)
      .set({ revokedAt })
      .where(
        and(
          eq(oauthRefreshTokens.clientId, clientId),
          eq(oauthRefreshTokens.userId, userId),
          isNull(oauthRefreshTokens.revokedAt),
        ),
      );
    signal.throwIfAborted();
    await tx
      .update(oauthAuthCodes)
      .set({ consumedAt: revokedAt })
      .where(
        and(
          eq(oauthAuthCodes.clientId, clientId),
          eq(oauthAuthCodes.userId, userId),
          isNull(oauthAuthCodes.consumedAt),
        ),
      );
    signal.throwIfAborted();
  });
  signal.throwIfAborted();
}
