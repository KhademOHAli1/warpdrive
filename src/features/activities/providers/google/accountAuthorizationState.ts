import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import {
  calendarOAuthAttempts,
  calendarProviderAccounts,
} from "@/db/schema/calendarProviderAccounts";
import { err, ok, type Result } from "@/types/result";
import { activeCalendarOwner, ownedCalendarAccount } from "./accountAccess";
import {
  type CalendarConnectionGenerations,
  readCalendarConnectionGenerations,
} from "./accountConnectionGeneration";
import {
  buildCalendarAuthorizationUrl,
  calendarOpaqueTokenSchema,
  createCalendarAuthorizationMaterial,
  hashCalendarOAuthToken,
} from "./authorization";
import {
  CALENDAR_OAUTH_TTL_MS,
  type CalendarAuthorizationError,
  type CalendarOAuthConfig,
} from "./authorizationConfig";
import { decryptCalendarSecret, encryptCalendarSecret } from "./tokenCrypto";

const MAX_UNEXPIRED_ATTEMPTS_PER_OWNER = 8;

export interface CalendarOAuthStart {
  state: string;
  browserNonce: string;
  authorizationUrl: string;
  expiresAt: string;
}
export interface CalendarAuthorizationOptions {
  accountId?: string;
  now?: () => Date;
}
export interface ConsumedCalendarAuthorization {
  stateHash: string;
  userId: string;
  codeVerifier: string;
  accountId: string | null;
  accountConnectionGeneration: number | null;
  accountConnectionGenerations: CalendarConnectionGenerations;
}
export const calendarCallbackInput = z.object({
  state: calendarOpaqueTokenSchema,
  browserNonce: calendarOpaqueTokenSchema,
  code: z.string().min(1).max(4096),
});

export async function beginCalendarAuthorization(
  db: Db,
  userId: string,
  config: CalendarOAuthConfig,
  signal: AbortSignal,
  options: CalendarAuthorizationOptions = {},
): Promise<Result<CalendarOAuthStart, CalendarAuthorizationError>> {
  signal.throwIfAborted();
  const material = createCalendarAuthorizationMaterial();
  const authUrl = buildCalendarAuthorizationUrl(config, material);
  if (!authUrl.ok) return authUrl;
  const now = options.now?.() ?? new Date();
  const expiresAt = new Date(now.getTime() + CALENDAR_OAUTH_TTL_MS);
  return db.transaction(async (tx) => {
    const owner = await activeCalendarOwner(tx, userId, signal, true);
    if (!owner.ok) return owner;
    const account =
      options.accountId === undefined
        ? null
        : await ownedCalendarAccount(tx, userId, options.accountId, signal);
    if (account !== null && !account.ok) return account;
    // Consumed or cancelled responses may still be in flight; only expiry frees a slot.
    const unexpired = await tx
      .select({ stateHash: calendarOAuthAttempts.stateHash })
      .from(calendarOAuthAttempts)
      .where(
        and(eq(calendarOAuthAttempts.userId, userId), gt(calendarOAuthAttempts.expiresAt, now)),
      )
      .limit(MAX_UNEXPIRED_ATTEMPTS_PER_OWNER);
    signal.throwIfAborted();
    if (unexpired.length >= MAX_UNEXPIRED_ATTEMPTS_PER_OWNER) return err({ kind: "rate_limited" });
    // Snapshot the owner's lifetimes before HTTP, including untargeted Connect flows.
    const connections = await tx
      .select({
        id: calendarProviderAccounts.id,
        generation: calendarProviderAccounts.connectionGeneration,
      })
      .from(calendarProviderAccounts)
      .where(
        and(
          eq(calendarProviderAccounts.userId, userId),
          eq(calendarProviderAccounts.provider, "google"),
        ),
      );
    signal.throwIfAborted();
    const generations: CalendarConnectionGenerations = {};
    for (const connection of connections) generations[connection.id] = connection.generation;
    await tx.insert(calendarOAuthAttempts).values({
      stateHash: material.stateHash,
      userId,
      browserBindingHash: material.browserBindingHash,
      codeVerifierEnc: encryptCalendarSecret(material.codeVerifier),
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      requestedAccess: config.access,
      accountId: account?.value.id ?? null,
      accountConnectionGeneration: account?.value.connectionGeneration ?? null,
      accountConnectionGenerations: generations,
      expiresAt,
    });
    signal.throwIfAborted();
    return ok({
      state: material.state,
      browserNonce: material.browserNonce,
      authorizationUrl: authUrl.value,
      expiresAt: expiresAt.toISOString(),
    });
  });
}

export async function consumeCalendarAuthorization(
  db: Db,
  userId: string,
  config: CalendarOAuthConfig,
  input: { state: string; browserNonce: string },
  signal: AbortSignal,
  clock: () => Date,
): Promise<Result<ConsumedCalendarAuthorization, CalendarAuthorizationError>> {
  return db.transaction(async (tx) => {
    const owner = await activeCalendarOwner(tx, userId, signal, true);
    if (!owner.ok) return err({ kind: "invalid_state" });
    const [attempt] = await tx
      .select()
      .from(calendarOAuthAttempts)
      .where(
        and(
          eq(calendarOAuthAttempts.stateHash, hashCalendarOAuthToken(input.state)),
          eq(calendarOAuthAttempts.userId, userId),
          eq(calendarOAuthAttempts.browserBindingHash, hashCalendarOAuthToken(input.browserNonce)),
        ),
      )
      .for("update");
    signal.throwIfAborted();
    // Lock waits consume the authorization lifetime just like provider HTTP does.
    const now = clock();
    if (
      attempt === undefined ||
      attempt.consumedAt !== null ||
      attempt.cancelledAt !== null ||
      attempt.expiresAt.getTime() <= now.getTime() ||
      attempt.clientId !== config.clientId ||
      attempt.redirectUri !== config.redirectUri ||
      attempt.requestedAccess !== config.access ||
      (attempt.accountId !== null && attempt.accountConnectionGeneration === null) ||
      attempt.codeVerifierEnc === null
    )
      return err({ kind: "invalid_state" });
    const generations = readCalendarConnectionGenerations(attempt.accountConnectionGenerations);
    if (generations === null) return err({ kind: "invalid_state" });
    if (attempt.accountId !== null) {
      const current = await ownedCalendarAccount(tx, userId, attempt.accountId, signal);
      if (
        !current.ok ||
        current.value.connectionGeneration !== attempt.accountConnectionGeneration ||
        generations[attempt.accountId] !== attempt.accountConnectionGeneration
      )
        return err({ kind: "invalid_state" });
    }
    const verifier = decryptCalendarSecret(attempt.codeVerifierEnc);
    if (!verifier.ok) return verifier;
    await tx
      .update(calendarOAuthAttempts)
      .set({ consumedAt: now, codeVerifierEnc: null })
      .where(eq(calendarOAuthAttempts.stateHash, attempt.stateHash));
    signal.throwIfAborted();
    return ok({
      stateHash: attempt.stateHash,
      userId,
      codeVerifier: verifier.value,
      accountId: attempt.accountId,
      accountConnectionGeneration: attempt.accountConnectionGeneration,
      accountConnectionGenerations: generations,
    });
  });
}
