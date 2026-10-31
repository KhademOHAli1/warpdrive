import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { authPasskeys, authUsers, sessions, users } from "@/db/schema";
import { readAuthPolicy } from "@/features/auth/management/policy";
import { evaluateSessionAccess } from "./accessPolicy";
import { isFreshAuthentication } from "./freshness";
import {
  AUTH_SESSION_COOKIE,
  hashSessionCredential,
  readCookie,
  sessionTokenFromCookie,
} from "./sessionToken";

export async function resolveWorkflowSession(
  db: Db,
  headers: Headers,
  signal: AbortSignal,
  options: { allowPending?: boolean; requireFresh?: boolean } = {},
) {
  signal.throwIfAborted();
  const cookie = readCookie(headers, AUTH_SESSION_COOKIE);
  const raw = cookie === null ? null : sessionTokenFromCookie(cookie);
  if (raw === null) return null;
  const now = new Date();
  const [row] = await db
    .select({ user: users, session: sessions, authUser: authUsers })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(authUsers, eq(authUsers.id, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionCredential(raw)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  signal.throwIfAborted();
  if (row === undefined) return null;
  const policy = await readAuthPolicy(db, signal);
  const decision = evaluateSessionAccess({
    ...policy,
    active: row.user.isActive,
    emailVerified: row.authUser.emailVerified,
    isAdmin: row.user.isAdmin,
    twoFactorEnabled: row.authUser.twoFactorEnabled,
    assurance: row.session.assurance,
    lastSeenAt: row.session.lastSeenAt,
    expiresAt: row.session.expiresAt,
    createdAt: row.session.createdAt,
    now,
  });
  if (
    !decision.allowed &&
    (options.allowPending !== true ||
      decision.reason === "expired" ||
      decision.reason === "inactive")
  )
    return null;
  if (options.requireFresh === true) {
    const [passkey] = await db
      .select({ id: authPasskeys.id })
      .from(authPasskeys)
      .where(eq(authPasskeys.userId, row.user.id))
      .limit(1);
    if (
      !decision.allowed ||
      !isFreshAuthentication(
        row.session,
        row.user.isAdmin ||
          row.authUser.twoFactorEnabled ||
          passkey !== undefined ||
          policy.requireMfaForAll,
        policy,
        now.getTime(),
      )
    )
      return null;
  }
  // Pending MFA may be inspected to finish authentication, but cannot extend an idle session.
  if (decision.allowed && now.getTime() - row.session.lastSeenAt.getTime() >= 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.session.id));
    signal.throwIfAborted();
  }
  return { ...row, policy };
}
