import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  calendarOAuthAttempts,
  calendarProviderAccounts,
} from "@/db/schema/calendarProviderAccounts";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { activeCalendarOwner, ownedCalendarAccount } from "./accountAccess";
import type { ConsumedCalendarAuthorization } from "./accountAuthorizationState";
import {
  calendarConnectionGenerationMatches,
  readCalendarConnectionGenerations,
  sameCalendarConnectionGenerations,
} from "./accountConnectionGeneration";
import { type CalendarIdentityPolicy, validateCalendarIdentity } from "./authorization";
import type { CalendarAuthorizationError, CalendarOAuthConfig } from "./authorizationConfig";
import { encryptCalendarSecret } from "./tokenCrypto";
import type { CalendarGoogleIdentity, CalendarTokenResponse } from "./tokenSchemas";

async function loadBindingAccount(
  tx: DbOrTx,
  consumed: ConsumedCalendarAuthorization,
  subject: string,
  signal: AbortSignal,
): Promise<
  Result<typeof calendarProviderAccounts.$inferSelect | undefined, CalendarAuthorizationError>
> {
  if (consumed.accountId !== null) {
    const loaded = await ownedCalendarAccount(tx, consumed.userId, consumed.accountId, signal);
    if (!loaded.ok) return loaded;
    return loaded.value.connectionGeneration === consumed.accountConnectionGeneration
      ? loaded
      : err({ kind: "conflict" });
  }
  const [account] = await tx
    .select()
    .from(calendarProviderAccounts)
    .where(
      and(
        eq(calendarProviderAccounts.userId, consumed.userId),
        eq(calendarProviderAccounts.provider, "google"),
        eq(calendarProviderAccounts.providerSubject, subject),
      ),
    );
  signal.throwIfAborted();
  if (
    account !== undefined &&
    !calendarConnectionGenerationMatches(consumed.accountConnectionGenerations, account)
  )
    return err({ kind: "conflict" });
  return ok(account);
}

export async function bindCalendarGrant(
  db: Db,
  consumed: ConsumedCalendarAuthorization,
  config: CalendarOAuthConfig,
  identity: CalendarGoogleIdentity,
  tokens: CalendarTokenResponse & { grantedScopes: string[] },
  policy: Omit<CalendarIdentityPolicy, "workspaceEmail" | "expectedSubject">,
  signal: AbortSignal,
  clock: () => Date,
): Promise<Result<{ accountId: string }, CalendarAuthorizationError>> {
  return db.transaction(async (tx) => {
    // Serialize binding and disconnect on the owner, including first-time connections
    // that have no account row to lock yet. HTTP exchange never holds this lock.
    const owner = await activeCalendarOwner(tx, consumed.userId, signal, true);
    if (!owner.ok) return owner;
    const [attempt] = await tx
      .select()
      .from(calendarOAuthAttempts)
      .where(
        and(
          eq(calendarOAuthAttempts.stateHash, consumed.stateHash),
          eq(calendarOAuthAttempts.userId, consumed.userId),
        ),
      )
      .for("update");
    signal.throwIfAborted();
    // An in-flight callback cannot carry its pre-lock timestamp past expiry.
    const now = clock();
    if (
      attempt === undefined ||
      attempt.consumedAt === null ||
      attempt.cancelledAt !== null ||
      attempt.expiresAt.getTime() <= now.getTime()
    )
      return err({ kind: "invalid_state" });
    const snapshot = readCalendarConnectionGenerations(attempt.accountConnectionGenerations);
    if (
      snapshot === null ||
      !sameCalendarConnectionGenerations(snapshot, consumed.accountConnectionGenerations) ||
      attempt.accountId !== consumed.accountId ||
      attempt.accountConnectionGeneration !== consumed.accountConnectionGeneration
    )
      return err({ kind: "invalid_state" });
    const loaded = await loadBindingAccount(tx, consumed, identity.subject, signal);
    if (!loaded.ok) return loaded;
    const account = loaded.value;
    const allowed = validateCalendarIdentity(identity, {
      ...policy,
      workspaceEmail: owner.value.email,
      ...(consumed.accountId !== null && account !== undefined
        ? { expectedSubject: account.providerSubject }
        : {}),
    });
    if (!allowed.ok) return allowed;
    const tokenEnc =
      tokens.refreshToken !== undefined
        ? encryptCalendarSecret(tokens.refreshToken)
        : account?.status === "connected" && account.clientId === config.clientId
          ? account.refreshTokenEnc
          : null;
    if (tokenEnc == null) return err({ kind: "refresh_missing" });
    const values = {
      clientId: config.clientId,
      emailAddress: identity.emailAddress,
      refreshTokenEnc: tokenEnc,
      scopes: tokens.grantedScopes,
      status: "connected" as const,
      disconnectedAt: null,
      connectedAt: now,
      updatedAt: now,
      lastErrorCode: null,
    };
    const [stored] =
      account === undefined
        ? await tx
            .insert(calendarProviderAccounts)
            .values({ ...values, userId: consumed.userId, providerSubject: identity.subject })
            .returning({ id: calendarProviderAccounts.id })
        : await tx
            .update(calendarProviderAccounts)
            .set({
              ...values,
              version: sql`${calendarProviderAccounts.version} + 1`,
              connectionGeneration: sql`${calendarProviderAccounts.connectionGeneration} + 1`,
            })
            .where(
              and(
                eq(calendarProviderAccounts.id, account.id),
                eq(calendarProviderAccounts.userId, consumed.userId),
                eq(calendarProviderAccounts.version, account.version),
                eq(calendarProviderAccounts.connectionGeneration, account.connectionGeneration),
              ),
            )
            .returning({ id: calendarProviderAccounts.id });
    signal.throwIfAborted();
    return stored === undefined ? err({ kind: "conflict" }) : ok({ accountId: stored.id });
  });
}
