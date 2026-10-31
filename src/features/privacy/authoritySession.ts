import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { authPasskeys, authUsers, sessions, users } from "@/db/schema";
import { evaluateSessionAccess } from "@/features/auth/better/accessPolicy";
import { isFreshAuthentication } from "@/features/auth/better/freshness";
import { readAuthPolicy } from "@/features/auth/management/policy";

// Internal IDs are accepted only after an HTTP credential check or from a protected durable job.
export interface PrivacyActor {
  userId: string;
  sessionId: string;
}

function hasFutureAuthentication(
  session: Pick<
    typeof sessions.$inferSelect,
    "freshAuthenticatedAt" | "mfaVerifiedAt" | "assurance"
  >,
  now: number,
): boolean {
  return (
    (session.freshAuthenticatedAt !== null && session.freshAuthenticatedAt.getTime() > now) ||
    (session.assurance === "mfa" &&
      session.mfaVerifiedAt !== null &&
      session.mfaVerifiedAt.getTime() > now)
  );
}

export async function currentPrivacySession(db: Db, actor: PrivacyActor, signal: AbortSignal) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, actor.userId))
    .for("no key update");
  signal.throwIfAborted();
  if (user === undefined || !user.isActive || user.invitedAt !== null) return false;
  const [identity] = await db
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, actor.userId))
    .for("no key update");
  signal.throwIfAborted();
  if (
    identity === undefined ||
    !identity.emailVerified ||
    identity.email.toLowerCase() !== user.email.toLowerCase()
  )
    return false;
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, actor.sessionId))
    .for("no key update");
  signal.throwIfAborted();
  if (
    session === undefined ||
    session.userId !== actor.userId ||
    session.revokedAt !== null ||
    session.authMethod === "legacy"
  )
    return false;
  const policy = await readAuthPolicy(db, signal);
  const [passkey] = await db
    .select({ id: authPasskeys.id })
    .from(authPasskeys)
    .where(eq(authPasskeys.userId, actor.userId))
    .limit(1);
  signal.throwIfAborted();
  const now = new Date();
  return (
    !hasFutureAuthentication(session, now.getTime()) &&
    evaluateSessionAccess({
      ...policy,
      active: user.isActive,
      emailVerified: identity.emailVerified,
      isAdmin: user.isAdmin,
      twoFactorEnabled: identity.twoFactorEnabled,
      assurance: session.assurance,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      now,
    }).allowed &&
    isFreshAuthentication(
      session,
      user.isAdmin || identity.twoFactorEnabled || passkey !== undefined || policy.requireMfaForAll,
      policy,
      now.getTime(),
    )
  );
}
