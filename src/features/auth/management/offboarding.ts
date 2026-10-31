import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { emailAccounts, sessions } from "@/db/schema";
import {
  authIntegrationRevocations,
  authInvitations,
  authMailOutbox,
} from "@/db/schema/authManagement";
import { revokeMcpGrants } from "./mcpGrants";

export async function revokeUserAccess(db: Db, userId: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const now = new Date();
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  await revokeMcpGrants(db, userId, signal);
  await db
    .update(authInvitations)
    .set({ revokedAt: now })
    .where(
      and(
        eq(authInvitations.userId, userId),
        isNull(authInvitations.revokedAt),
        isNull(authInvitations.acceptedAt),
      ),
    );
  await db
    .update(authMailOutbox)
    .set({ status: "cancelled" })
    .where(and(eq(authMailOutbox.userId, userId), eq(authMailOutbox.status, "pending")));
  const accounts = await db
    .select({ id: emailAccounts.id, token: emailAccounts.refreshTokenEnc })
    .from(emailAccounts)
    .where(eq(emailAccounts.userId, userId))
    .for("update");
  for (const account of accounts) {
    if (account.token !== null)
      await db
        .insert(authIntegrationRevocations)
        .values({ userId, provider: "google", tokenEnc: account.token });
  }
  await db
    .update(emailAccounts)
    .set({ status: "disconnected", refreshTokenEnc: null, watchExpiresAt: null, updatedAt: now })
    .where(eq(emailAccounts.userId, userId));
  signal.throwIfAborted();
}
