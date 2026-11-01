import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { authUsers, sessions, users } from "@/db/schema";
import { evaluateSessionAccess } from "@/features/auth/better/accessPolicy";
import { lockAuthAccount } from "@/features/auth/better/accountLock";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { readAuthPolicy } from "@/features/auth/management/policy";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { MailboxActorSession } from "./mailConnectionSchemas";

const contextSchema = z.strictObject({ actorId: z.guid(), sessionId: z.guid() });

// Ordinary annotations require a current full session, without credential-grant freshness.
// Keep the native account/policy fences until the annotation transaction commits.
export async function lockDeliveryObservationSession(
  tx: DbOrTx,
  context: MailboxActorSession,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  if (!contextSchema.safeParse(context).success) return false;
  await lockAuthAccount(tx, context.actorId, signal);
  await lockMcpGrants(tx, signal);
  const [user] = await tx
    .select()
    .from(users)
    .where(eq(users.id, context.actorId))
    .for("no key update");
  signal.throwIfAborted();
  if (user === undefined || !user.isActive || user.invitedAt !== null) return false;
  const [session] = await tx
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.id, context.sessionId),
        eq(sessions.userId, user.id),
        isNull(sessions.revokedAt),
      ),
    )
    .for("no key update");
  signal.throwIfAborted();
  const [identity] = await tx
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, user.id))
    .for("no key update");
  signal.throwIfAborted();
  if (session === undefined || identity === undefined) return false;
  const policy = await readAuthPolicy(tx, signal);
  signal.throwIfAborted();
  return evaluateSessionAccess({
    ...policy,
    active: user.isActive,
    emailVerified: identity.emailVerified,
    isAdmin: user.isAdmin,
    twoFactorEnabled: identity.twoFactorEnabled,
    assurance: session.assurance,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    now: new Date(),
  }).allowed;
}

export async function lockDeliveryObservationReader(
  tx: DbOrTx,
  actorId: string,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  if (!z.guid().safeParse(actorId).success) return false;
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, actorId), eq(users.isActive, true), isNull(users.invitedAt)))
    .for("share");
  signal.throwIfAborted();
  return user !== undefined;
}
