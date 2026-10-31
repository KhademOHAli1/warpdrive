import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { authRecoveryRequests, authUsers, users } from "@/db/schema";
import { recordSecurityEvent } from "@/features/auth/management/audit";
import { enqueueAuthMail } from "@/features/auth/management/mail";
import { authMailLocale } from "./mailLocale";

export async function requestFactorRecovery(
  db: Db,
  email: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .innerJoin(authUsers, eq(authUsers.id, users.id))
    .where(
      and(
        eq(users.email, email.trim().toLowerCase()),
        eq(users.isActive, true),
        eq(authUsers.emailVerified, true),
      ),
    )
    .limit(1);
  if (user === undefined) return;
  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
    const [pending] = await tx
      .select({ id: authRecoveryRequests.id })
      .from(authRecoveryRequests)
      .where(
        and(
          eq(authRecoveryRequests.userId, user.id),
          eq(authRecoveryRequests.kind, "factor_recovery"),
          eq(authRecoveryRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (pending !== undefined) return;
    await tx.insert(authRecoveryRequests).values({ userId: user.id, kind: "factor_recovery" });
    await recordSecurityEvent(
      tx,
      { targetUserId: user.id, action: "account.recovery_requested", outcome: "success" },
      signal,
    );
    await enqueueAuthMail(
      tx,
      {
        userId: user.id,
        recipient: user.email,
        locale: await authMailLocale(tx, user.id),
        kind: "recovery",
      },
      signal,
    );
  });
  signal.throwIfAborted();
}
