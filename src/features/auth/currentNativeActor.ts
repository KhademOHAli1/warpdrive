import { and, eq, is, isNull, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
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
  return readNativeActor(tx, who, signal);
}

/**
 * Read-only observation of the same native session policy in the caller's fresh,
 * pool-owned snapshot. Mutation callers continue to use the READ COMMITTED fence.
 */
export async function currentNativeReadActor(
  tx: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
): Promise<CurrentNativeActor | null> {
  signal.throwIfAborted();
  if (!is(tx, PgTransaction))
    throw new AppError(
      ERROR_IDS.DB_INVARIANT,
      "Native snapshot actor requires an owned transaction",
    );
  const state = await tx.execute<{ ready: boolean }>(sql`
    SELECT current_setting('transaction_isolation') = 'repeatable read'
      AND current_setting('transaction_read_only') = 'on'
      AND pg_catalog.pg_current_xact_id_if_assigned() IS NULL
      AND NOT pg_catalog.pg_is_in_recovery() AS ready
  `);
  signal.throwIfAborted();
  if (state.rows[0]?.ready !== true)
    throw new AppError(
      ERROR_IDS.DB_INVARIANT,
      "Native snapshot actor requires read-only repeatable read",
    );
  return readNativeActor(tx, who, signal);
}

async function readNativeActor(
  tx: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
): Promise<CurrentNativeActor | null> {
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
