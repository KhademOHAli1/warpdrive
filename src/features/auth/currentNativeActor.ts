import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { authUsers, sessions, users } from "@/db/schema";
import { type HydratedActor, hydrateActor } from "@/server/hydrateActor";
import { evaluateSessionAccess } from "./better/accessPolicy";
import { requireCurrentAuthority } from "./currentAuthority";
import { readAuthPolicy } from "./management/policy";

/** Only a genuine server authentication context may supply these internal references. */
export interface NativeSessionRef {
  readonly userId: string;
  readonly sessionId: string;
}

export interface CurrentNativeActor {
  actor: HydratedActor;
  primaryVisibilityGroupId: string | null;
}

/** Routine create access: no fresh-auth requirement, no idle touch, no authority from IDs alone. */
export async function currentNativeActor(
  tx: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
): Promise<CurrentNativeActor | null> {
  await requireCurrentAuthority(tx, signal);
  const [row] = await tx
    .select({ session: sessions, authUser: authUsers, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(authUsers, eq(authUsers.id, users.id))
    .where(
      and(
        eq(sessions.id, who.sessionId),
        eq(sessions.userId, who.userId),
        isNull(sessions.revokedAt),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  signal.throwIfAborted();
  if (row === undefined) return null;
  const policy = row.session.authMethod === "legacy" ? null : await readAuthPolicy(tx, signal);
  const actor = await hydrateActor(tx, who.userId, signal);
  if (actor === null) return null;
  // Sample wall time after policy/hydration waits: transaction now() would freeze at BEGIN.
  const clock = await tx.execute<{ milliseconds: string }>(
    sql`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::text AS milliseconds`,
  );
  signal.throwIfAborted();
  const milliseconds = Number(clock.rows[0]?.milliseconds);
  if (!Number.isFinite(milliseconds) || row.session.expiresAt.getTime() <= milliseconds)
    return null;
  // Match the public loader's supported legacy profile, including no auth_users requirement.
  if (row.session.authMethod !== "legacy") {
    if (row.authUser === null || policy === null) return null;
    const access = evaluateSessionAccess({
      ...policy,
      active: row.user.isActive,
      emailVerified: row.authUser.emailVerified,
      isAdmin: row.user.isAdmin,
      twoFactorEnabled: row.authUser.twoFactorEnabled,
      assurance: row.session.assurance,
      lastSeenAt: row.session.lastSeenAt,
      expiresAt: row.session.expiresAt,
      createdAt: row.session.createdAt,
      now: new Date(milliseconds),
    });
    if (!access.allowed) return null;
  }
  return { actor, primaryVisibilityGroupId: row.user.primaryVisibilityGroupId };
}
