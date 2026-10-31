import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { oauthAccessTokens, oauthAuthCodes, oauthRefreshTokens } from "@/db/schema";

// Acquire inside the caller's transaction, after any account advisory lock and before user locks.
// OAuth issuance shares this lock so an in-flight exchange cannot escape a revocation sweep.
export async function lockMcpGrants(db: Db, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-auth'), hashtext('mcp-grants'))`,
  );
  signal.throwIfAborted();
}

// null deliberately means every user, only for a workspace-wide authentication-policy change.
export async function revokeMcpGrants(
  db: Db,
  userId: string | null,
  signal: AbortSignal,
): Promise<void> {
  await lockMcpGrants(db, signal);
  const now = new Date();
  await db
    .update(oauthAccessTokens)
    .set({ revokedAt: now })
    .where(
      and(
        userId === null ? undefined : eq(oauthAccessTokens.userId, userId),
        isNull(oauthAccessTokens.revokedAt),
      ),
    );
  await db
    .update(oauthRefreshTokens)
    .set({ revokedAt: now })
    .where(
      and(
        userId === null ? undefined : eq(oauthRefreshTokens.userId, userId),
        isNull(oauthRefreshTokens.revokedAt),
      ),
    );
  await db
    .update(oauthAuthCodes)
    .set({ consumedAt: now })
    .where(
      and(
        userId === null ? undefined : eq(oauthAuthCodes.userId, userId),
        isNull(oauthAuthCodes.consumedAt),
      ),
    );
  signal.throwIfAborted();
}
