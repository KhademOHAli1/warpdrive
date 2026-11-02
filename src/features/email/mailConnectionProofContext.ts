import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { authPasskeys, authUsers, sessions, users } from "@/db/schema";
import { evaluateSessionAccess } from "@/features/auth/better/accessPolicy";
import { lockAuthAccount } from "@/features/auth/better/accountLock";
import { isFreshAuthentication } from "@/features/auth/better/freshness";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { readAuthPolicy } from "@/features/auth/management/policy";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { checkedMailboxSchema, type MailboxActorSession } from "./mailConnectionSchemas";

export const mailboxProofEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  actorId: z.uuid(),
  sessionId: z.uuid(),
  checked: checkedMailboxSchema,
});

export const hashMailboxProof = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

// Grant creation and mutation recheck native authority under the same fences as
// policy/factor changes; an earlier HTTP check is not a commit-time capability.
export async function lockMailboxSession(
  db: DbOrTx,
  context: MailboxActorSession,
  signal: AbortSignal,
): Promise<boolean> {
  await lockAuthAccount(db, context.actorId, signal);
  await lockMcpGrants(db, signal);
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, context.actorId))
    .for("no key update");
  signal.throwIfAborted();
  if (user === undefined || !user.isActive || user.invitedAt !== null) return false;
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.id, context.sessionId),
        eq(sessions.userId, context.actorId),
        isNull(sessions.revokedAt),
      ),
    )
    .for("no key update");
  const [identity] = await db
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, context.actorId))
    .for("no key update");
  signal.throwIfAborted();
  if (session === undefined || identity === undefined) return false;
  const policy = await readAuthPolicy(db, signal);
  const [passkey] = await db
    .select({ id: authPasskeys.id })
    .from(authPasskeys)
    .where(eq(authPasskeys.userId, user.id))
    .limit(1);
  signal.throwIfAborted();
  const now = new Date();
  const decision = evaluateSessionAccess({
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
  });
  return (
    decision.allowed &&
    isFreshAuthentication(
      session,
      user.isAdmin || identity.twoFactorEnabled || passkey !== undefined || policy.requireMfaForAll,
      policy,
      now.getTime(),
    )
  );
}
