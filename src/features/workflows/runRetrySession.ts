import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { authUsers, sessions, users } from "@/db/schema";
import { evaluateSessionAccess } from "@/features/auth/better/accessPolicy";
import { readAuthPolicy } from "@/features/auth/management/policy";
import { hydrateActor } from "@/server/hydrateActor";
import type { RetrySessionRef } from "./runRetryTypes";

// Called after the run-row wait, using the actual native context's internal
// reference. This does not touch freshness or enroll other authority writers in
// a global fence; execution continues to recheck authority at each step claim.
export async function currentRetryActor(db: Db, who: RetrySessionRef, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!z.strictObject({ userId: z.uuid(), sessionId: z.uuid() }).safeParse(who).success)
    return null;
  const [row] = await db
    .select({ user: users, session: sessions, identity: authUsers })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(authUsers, eq(authUsers.id, users.id))
    .where(and(eq(sessions.id, who.sessionId), eq(sessions.userId, who.userId)))
    .limit(1);
  signal.throwIfAborted();
  if (
    row === undefined ||
    !row.user.isActive ||
    row.user.invitedAt !== null ||
    row.session.revokedAt !== null ||
    row.identity.email.toLowerCase() !== row.user.email.toLowerCase()
  )
    return null;
  const policy = await readAuthPolicy(db, signal);
  const actor = await hydrateActor(db, who.userId, signal);
  const clock = await db.execute<{ milliseconds: number }>(
    sql`SELECT extract(epoch from clock_timestamp())::double precision * 1000 AS milliseconds`,
  );
  signal.throwIfAborted();
  const now = new Date(clock.rows[0]?.milliseconds ?? Number.NaN);
  if (!Number.isFinite(now.getTime())) return null;
  const access = evaluateSessionAccess({
    ...policy,
    active: row.user.isActive,
    emailVerified: row.identity.emailVerified,
    isAdmin: row.user.isAdmin,
    twoFactorEnabled: row.identity.twoFactorEnabled,
    assurance: row.session.assurance,
    lastSeenAt: row.session.lastSeenAt,
    expiresAt: row.session.expiresAt,
    createdAt: row.session.createdAt,
    now,
  });
  return access.allowed ? actor : null;
}
