import { and, eq, isNull } from "drizzle-orm";
import { authUsers, sessions, users } from "@/db/schema";
import { evaluateSessionAccess } from "@/features/auth/better/accessPolicy";
import { readAuthPolicy } from "@/features/auth/management/policy";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { ReadIntentRemoteDispatch } from "./readIntentRemoteReceipt";

// This observation is repeated by the transport's pre-mutation callback. Its
// caller uses READ COMMITTED; no native auth row/advisory lock spans provider I/O.
export async function readIntentRemoteSessionCurrent(
  tx: DbOrTx,
  dispatch: ReadIntentRemoteDispatch,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const actorId = dispatch.key.actorId;
  if (
    dispatch.actor.id !== actorId ||
    dispatch.session.actorId !== actorId ||
    dispatch.binding.actorId !== actorId ||
    dispatch.binding.mailboxOwnerId !== actorId ||
    dispatch.binding.threadId !== dispatch.key.threadId ||
    dispatch.binding.readMode !== "imap" ||
    dispatch.binding.accountProvider !== "imap_smtp"
  )
    return false;

  const policy = await readAuthPolicy(tx, signal);
  const [authority] = await tx
    .select({
      active: users.isActive,
      isAdmin: users.isAdmin,
      emailVerified: authUsers.emailVerified,
      twoFactorEnabled: authUsers.twoFactorEnabled,
      assurance: sessions.assurance,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      createdAt: sessions.createdAt,
    })
    .from(users)
    .innerJoin(authUsers, eq(authUsers.id, users.id))
    .innerJoin(
      sessions,
      and(
        eq(sessions.userId, users.id),
        eq(sessions.id, dispatch.session.sessionId),
        isNull(sessions.revokedAt),
      ),
    )
    .where(and(eq(users.id, actorId), eq(users.isActive, true), isNull(users.invitedAt)));
  signal.throwIfAborted();
  if (authority === undefined) return false;
  return evaluateSessionAccess({ ...policy, ...authority, now: new Date() }).allowed;
}
