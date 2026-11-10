import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { calendarProviderAccounts } from "@/db/schema/calendarProviderAccounts";
import { err, ok, type Result } from "@/types/result";
import { activeCalendarOwner, ownedCalendarAccount } from "./accountAccess";
import {
  type CalendarAuthorizationError,
  type CalendarOAuthConfig,
  readCalendarOAuthConfig,
} from "./authorizationConfig";
import type { GoogleTransport } from "./contracts";
import { hasRequiredCalendarConsent, refreshCalendarToken } from "./tokenClient";
import { decryptCalendarSecret, encryptCalendarSecret } from "./tokenCrypto";

export interface CalendarAccessGrant {
  accountId: string;
  connectionGeneration: number;
  accessToken: string;
  expiresAt: number;
  grantedScopes: string[];
}
export async function getCalendarAccessGrant(
  db: Db,
  userId: string,
  accountId: string,
  config: CalendarOAuthConfig,
  signal: AbortSignal,
  options: { transport?: GoogleTransport; now?: () => Date } = {},
): Promise<Result<CalendarAccessGrant, CalendarAuthorizationError>> {
  signal.throwIfAborted();
  const validated = readCalendarOAuthConfig(config);
  if (!validated.ok) return validated;
  const loaded = await ownedCalendarAccount(db, userId, accountId, signal);
  if (!loaded.ok) return loaded;
  const account = loaded.value;
  if (account.status !== "connected" || account.refreshTokenEnc === null)
    return err({ kind: "disconnected" });
  if (account.clientId !== validated.value.clientId) return err({ kind: "configuration" });
  if (!hasRequiredCalendarConsent(account.scopes, config.access))
    return err({ kind: "missing_scope" });
  const decrypted = decryptCalendarSecret(account.refreshTokenEnc);
  if (!decrypted.ok) return decrypted;
  const refreshed = await refreshCalendarToken(
    validated.value,
    { refreshToken: decrypted.value, signal },
    options.transport,
  );
  const now = options.now?.() ?? new Date();
  return db.transaction(async (tx) => {
    const owner = await activeCalendarOwner(tx, userId, signal, true);
    if (!owner.ok) return owner;
    const current = await ownedCalendarAccount(tx, userId, accountId, signal);
    if (!current.ok) return current;
    if (
      current.value.status !== "connected" ||
      current.value.version !== account.version ||
      current.value.connectionGeneration !== account.connectionGeneration
    )
      return err({ kind: "conflict" });
    if (!refreshed.ok) {
      if (refreshed.error.kind === "unauthorized" || refreshed.error.kind === "missing_scope") {
        await tx
          .update(calendarProviderAccounts)
          .set({
            status: "reauthRequired",
            refreshTokenEnc: null,
            version: sql`${calendarProviderAccounts.version} + 1`,
            connectionGeneration: sql`${calendarProviderAccounts.connectionGeneration} + 1`,
            lastErrorCode: refreshed.error.kind,
            updatedAt: now,
          })
          .where(
            and(
              eq(calendarProviderAccounts.id, accountId),
              eq(calendarProviderAccounts.userId, userId),
              eq(calendarProviderAccounts.status, "connected"),
              eq(calendarProviderAccounts.version, account.version),
              eq(calendarProviderAccounts.connectionGeneration, account.connectionGeneration),
            ),
          );
        signal.throwIfAborted();
      }
      return refreshed;
    }
    const scopes = refreshed.value.grantedScopes ?? account.scopes;
    const [updated] = await tx
      .update(calendarProviderAccounts)
      .set({
        ...(refreshed.value.refreshToken !== undefined
          ? { refreshTokenEnc: encryptCalendarSecret(refreshed.value.refreshToken) }
          : {}),
        scopes,
        version: sql`${calendarProviderAccounts.version} + 1`,
        lastErrorCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(calendarProviderAccounts.id, accountId),
          eq(calendarProviderAccounts.userId, userId),
          eq(calendarProviderAccounts.status, "connected"),
          eq(calendarProviderAccounts.version, account.version),
          eq(calendarProviderAccounts.connectionGeneration, account.connectionGeneration),
        ),
      )
      .returning({
        id: calendarProviderAccounts.id,
        connectionGeneration: calendarProviderAccounts.connectionGeneration,
      });
    signal.throwIfAborted();
    return updated === undefined
      ? err({ kind: "conflict" })
      : ok({
          accountId: updated.id,
          connectionGeneration: updated.connectionGeneration,
          accessToken: refreshed.value.accessToken,
          expiresAt: now.getTime() + refreshed.value.expiresIn * 1000,
          grantedScopes: scopes,
        });
  });
}
