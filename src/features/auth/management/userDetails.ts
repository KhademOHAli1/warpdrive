import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { authAccounts, authPasskeys, authUsers, sessions, users } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { recordSecurityEvent } from "./audit";
import type { ManagedUserDetails } from "./contracts";
import { enqueueUserSecurityNotice } from "./notices";

export async function readManagedUserDetails(
  db: Db,
  actor: PermSetUser,
  userId: string,
  signal: AbortSignal,
): Promise<Result<ManagedUserDetails, "forbidden" | "not_found">> {
  if (!actor.isActive || actor.type !== "admin") return err("forbidden");
  signal.throwIfAborted();
  const [user] = await db
    .select({
      id: users.id,
      emailVerified: authUsers.emailVerified,
      twoFactorEnabled: authUsers.twoFactorEnabled,
    })
    .from(users)
    .leftJoin(authUsers, eq(authUsers.id, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (user === undefined) return err("not_found");
  const accounts = await db
    .select({ provider: authAccounts.providerId })
    .from(authAccounts)
    .where(eq(authAccounts.userId, userId));
  const [passkeyCount] = await db
    .select({ total: count() })
    .from(authPasskeys)
    .where(eq(authPasskeys.userId, userId));
  const activeSessions = await db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  signal.throwIfAborted();
  return ok({
    userId,
    emailVerified: user.emailVerified ?? false,
    twoFactorEnabled: user.twoFactorEnabled ?? false,
    passkeyCount: passkeyCount?.total ?? 0,
    providers: [...new Set(accounts.map((account) => account.provider))],
    sessions: activeSessions.map((session) => ({
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    })),
  });
}

export async function revokeManagedSession(
  db: Db,
  actor: PermSetUser,
  userId: string,
  sessionId: string,
  signal: AbortSignal,
): Promise<Result<true, "forbidden" | "not_found">> {
  if (!actor.isActive || actor.type !== "admin") return err("forbidden");
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    const [revoked] = await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)),
      )
      .returning({ id: sessions.id });
    if (revoked === undefined) return err("not_found");
    await recordSecurityEvent(
      tx,
      {
        actorId: actor.id,
        targetUserId: userId,
        action: "session.admin_revoke",
        outcome: "success",
      },
      signal,
    );
    await enqueueUserSecurityNotice(tx, userId, "admin_sessions", signal);
    return ok(true);
  });
}
