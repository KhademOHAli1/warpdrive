import { and, eq, isNull, sql } from "drizzle-orm";
import { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { emailAccounts, sessions, users } from "@/db/schema";
import {
  authIntegrationRevocations,
  authInvitations,
  authMailOutbox,
} from "@/db/schema/authManagement";
import { lockAuthAccount } from "@/features/auth/better/accountLock";
import { lockMcpGrants, revokeMcpGrants } from "./mcpGrants";

export async function revokeUserAccess(db: Db, userId: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await db.transaction(async (tx) => {
    // Preserve the established auth order before taking owner/mailbox row locks.
    await lockAuthAccount(tx, userId, signal);
    await lockMcpGrants(tx, signal);
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("no key update");
    const now = new Date();
    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    await revokeMcpGrants(tx, userId, signal);
    await tx
      .update(authInvitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(authInvitations.userId, userId),
          isNull(authInvitations.revokedAt),
          isNull(authInvitations.acceptedAt),
        ),
      );
    await tx
      .update(authMailOutbox)
      .set({ status: "cancelled" })
      .where(and(eq(authMailOutbox.userId, userId), eq(authMailOutbox.status, "pending")));
    const accounts = await tx
      .select({
        id: emailAccounts.id,
        provider: emailAccounts.provider,
        token: emailAccounts.refreshTokenEnc,
      })
      .from(emailAccounts)
      .where(eq(emailAccounts.userId, userId))
      .for("update");
    for (const account of accounts) {
      if (account.provider === "gmail" && account.token !== null) {
        const [revocation] = await tx
          .insert(authIntegrationRevocations)
          .values({ userId, provider: "google", tokenEnc: account.token })
          .returning({ id: authIntegrationRevocations.id });
        if (revocation === undefined)
          throw new AppError("E_DB_001", "revocation was not queued", {});
        await tx
          .update(emailAccounts)
          .set({
            connectionSettings: sql`jsonb_set(coalesce(${emailAccounts.connectionSettings},'{}'::jsonb),'{remoteRevocationId}',to_jsonb(${revocation.id}::text))`,
          })
          .where(eq(emailAccounts.id, account.id));
      }
    }
    await tx
      .update(emailAccounts)
      .set({
        status: "disconnected",
        isDefault: false,
        paused: false,
        refreshTokenEnc: null,
        credentialsEnc: null,
        connectionGeneration: sql`${emailAccounts.connectionGeneration} + 1`,
        credentialVersion: sql`${emailAccounts.credentialVersion} + 1`,
        watchExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(emailAccounts.userId, userId));
    signal.throwIfAborted();
  });
}
