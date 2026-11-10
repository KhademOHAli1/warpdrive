import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import {
  calendarOAuthAttempts,
  calendarProviderAccounts,
} from "@/db/schema/calendarProviderAccounts";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { ok, type Result } from "@/types/result";
import { activeCalendarOwner, ownedCalendarAccount } from "./accountAccess";
import type { CalendarAuthorizationError } from "./authorizationConfig";
export interface CalendarAccountSummary {
  id: string;
  provider: "google";
  emailAddress: string;
  status: "connected" | "reauthRequired" | "disconnected";
  scopes: string[];
  version: number;
  connectedAt: string;
  disconnectedAt: string | null;
}

export async function listCalendarProviderAccounts(
  db: Db,
  userId: string,
  signal: AbortSignal,
): Promise<Result<CalendarAccountSummary[], CalendarAuthorizationError>> {
  const owner = await activeCalendarOwner(db, userId, signal);
  if (!owner.ok) return owner;
  // Never select encrypted credentials for a DTO returned to a request handler.
  const rows = await db
    .select({
      id: calendarProviderAccounts.id,
      provider: calendarProviderAccounts.provider,
      emailAddress: calendarProviderAccounts.emailAddress,
      status: calendarProviderAccounts.status,
      scopes: calendarProviderAccounts.scopes,
      version: calendarProviderAccounts.version,
      connectedAt: calendarProviderAccounts.connectedAt,
      disconnectedAt: calendarProviderAccounts.disconnectedAt,
    })
    .from(calendarProviderAccounts)
    .innerJoin(users, and(eq(users.id, calendarProviderAccounts.userId), eq(users.isActive, true)))
    .where(eq(calendarProviderAccounts.userId, userId));
  signal.throwIfAborted();
  return ok(
    rows.map((row) => ({
      ...row,
      connectedAt: row.connectedAt.toISOString(),
      disconnectedAt: row.disconnectedAt?.toISOString() ?? null,
    })),
  );
}
async function cancelCalendarOwnerAttempts(
  tx: DbOrTx,
  userId: string,
  signal: AbortSignal,
): Promise<void> {
  await tx
    .update(calendarOAuthAttempts)
    .set({ cancelledAt: new Date(), codeVerifierEnc: null })
    .where(
      and(eq(calendarOAuthAttempts.userId, userId), isNull(calendarOAuthAttempts.cancelledAt)),
    );
  signal.throwIfAborted();
}
export async function disconnectCalendarProviderAccount(
  db: Db,
  userId: string,
  accountId: string,
  signal: AbortSignal,
): Promise<Result<undefined, CalendarAuthorizationError>> {
  return db.transaction(async (tx) => {
    const owner = await activeCalendarOwner(tx, userId, signal, true);
    if (!owner.ok) return owner;
    const account = await ownedCalendarAccount(tx, userId, accountId, signal);
    if (!account.ok) return account;
    await tx
      .update(calendarProviderAccounts)
      .set({
        status: "disconnected",
        refreshTokenEnc: null,
        version: sql`${calendarProviderAccounts.version} + 1`,
        connectionGeneration: sql`${calendarProviderAccounts.connectionGeneration} + 1`,
        disconnectedAt: new Date(),
        updatedAt: new Date(),
        lastErrorCode: null,
      })
      .where(eq(calendarProviderAccounts.id, accountId));
    await cancelCalendarOwnerAttempts(tx, userId, signal);
    return ok(undefined);
  });
}

// Trusted lifecycle seam. The caller must already authorize offboarding and pass its
// transaction; an inactive owner is deliberately accepted here so credentials are purged.
export async function revokeCalendarProviderAccountsForUser(
  tx: DbOrTx,
  userId: string,
  signal: AbortSignal,
): Promise<void> {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  signal.throwIfAborted();
  await tx
    .update(calendarProviderAccounts)
    .set({
      status: "disconnected",
      refreshTokenEnc: null,
      version: sql`${calendarProviderAccounts.version} + 1`,
      connectionGeneration: sql`${calendarProviderAccounts.connectionGeneration} + 1`,
      disconnectedAt: new Date(),
      updatedAt: new Date(),
      lastErrorCode: null,
    })
    .where(eq(calendarProviderAccounts.userId, userId));
  await cancelCalendarOwnerAttempts(tx, userId, signal);
}
