import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  authAccounts,
  authPasskeys,
  authSecurityEvents,
  authTwoFactors,
  sessions,
} from "@/db/schema";
import type { SecurityStatus } from "./contracts";
import { isFreshAuthentication } from "./freshness";
import { resolveWorkflowSession } from "./sessionPolicy";

export async function readSecurityStatus(
  db: Db,
  headers: Headers,
  signal: AbortSignal,
): Promise<SecurityStatus | null> {
  const current = await resolveWorkflowSession(db, headers, signal, { allowPending: true });
  if (current === null) return null;
  const userId = current.user.id;
  const [accounts, passkeys, devices, audit, factors] = await Promise.all([
    db
      .select({
        id: authAccounts.id,
        providerId: authAccounts.providerId,
        accountId: authAccounts.accountId,
        hasPassword: authAccounts.password,
      })
      .from(authAccounts)
      .where(eq(authAccounts.userId, userId)),
    db
      .select({
        id: authPasskeys.id,
        name: authPasskeys.name,
        createdAt: authPasskeys.createdAt,
        deviceType: authPasskeys.deviceType,
        backedUp: authPasskeys.backedUp,
      })
      .from(authPasskeys)
      .where(eq(authPasskeys.userId, userId)),
    db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(sessions.createdAt)),
    db
      .select({
        id: authSecurityEvents.id,
        action: authSecurityEvents.action,
        outcome: authSecurityEvents.outcome,
        createdAt: authSecurityEvents.createdAt,
      })
      .from(authSecurityEvents)
      .where(eq(authSecurityEvents.targetUserId, userId))
      .orderBy(desc(authSecurityEvents.createdAt))
      .limit(20),
    db
      .select({ codes: authTwoFactors.backupCodes })
      .from(authTwoFactors)
      .where(eq(authTwoFactors.userId, userId))
      .limit(1),
  ]);
  signal.throwIfAborted();
  const strong = current.session.assurance === "mfa" || current.session.assurance === "passkey";
  const requires =
    current.user.isAdmin || current.policy.requireMfaForAll || current.authUser.twoFactorEnabled;
  return {
    authenticated: true,
    user: {
      id: userId,
      name: current.user.name,
      email: current.user.email,
      isAdmin: current.user.isAdmin,
    },
    emailVerified: current.authUser.emailVerified,
    hasPassword: accounts.some(
      (account) => account.providerId === "credential" && account.hasPassword !== null,
    ),
    twoFactorEnabled: current.authUser.twoFactorEnabled,
    needsMfa: requires && !strong,
    needsEnrollment:
      !strong &&
      (current.user.isAdmin || current.policy.requireMfaForAll) &&
      !current.authUser.twoFactorEnabled &&
      passkeys.length === 0,
    fresh: isFreshAuthentication(current.session, requires || passkeys.length > 0, current.policy),
    authMethod: current.session.authMethod,
    policy: current.policy,
    accounts: accounts.map(({ id, providerId, accountId }) => ({ id, providerId, accountId })),
    passkeys: passkeys.map((key) => ({ ...key, createdAt: key.createdAt.toISOString() })),
    sessions: devices.map((session) => ({
      id: session.id,
      current: session.id === current.session.id,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
    })),
    recoveryCodesAvailable: (factors[0]?.codes.length ?? 0) > 2,
    audit: audit.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  };
}
