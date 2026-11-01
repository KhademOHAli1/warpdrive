import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { Db } from "@/db/client";
import { authIntegrationRevocations } from "@/db/schema/authManagement";
import { pruneEmailVerificationTokens } from "@/features/auth/better/emailVerification";
import { pruneAuthRateLimits } from "@/features/auth/better/rateLimit";
import { pruneTotpReplays } from "@/features/auth/better/totpReplay";
import { decryptToken } from "@/features/email/crypto";
import { pruneMailboxProofs } from "@/features/email/mailConnectionMaintenance";
import { expireAuthenticationRecords } from "./administration";
import { MAIL_LEASE_MS } from "./domain";
import { dispatchAuthMail } from "./mail";

const AUTH_MAINTENANCE_QUEUE = "auth-maintenance";
type RevocationRow = typeof authIntegrationRevocations.$inferSelect;

async function claimRevocations(db: Db, claimId: string): Promise<RevocationRow[]> {
  await db.execute(sql`
    UPDATE auth_integration_revocations SET status='sending', claim_id=${claimId}, claimed_at=now(), attempts=attempts+1
    WHERE id IN (SELECT id FROM auth_integration_revocations
      WHERE (status IN ('pending','failed') AND next_attempt_at<=now())
        OR (status='sending' AND claimed_at<${new Date(Date.now() - MAIL_LEASE_MS)})
      ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED)
  `);
  return db
    .select()
    .from(authIntegrationRevocations)
    .where(eq(authIntegrationRevocations.claimId, claimId));
}

async function revokeIntegration(row: RevocationRow, signal: AbortSignal): Promise<boolean> {
  if (row.tokenEnc === null) return true;
  const decoded = decryptToken(row.tokenEnc);
  if (!decoded.ok || row.provider !== "google") return false;
  try {
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: decoded.value }),
      signal,
    });
    // An already-invalid token is terminal; local access is never restored on remote failure.
    return response.ok || response.status === 400;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}

export async function dispatchIntegrationRevocations(db: Db, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const claimId = randomUUID();
  const rows = await claimRevocations(db, claimId);
  for (const row of rows) {
    signal.throwIfAborted();
    const success = await revokeIntegration(row, signal);
    await db
      .update(authIntegrationRevocations)
      .set({
        status: success ? "revoked" : "failed",
        tokenEnc: success ? null : row.tokenEnc,
        lastErrorCode: success ? null : "provider_revocation_failed",
        nextAttemptAt: new Date(
          Date.now() + Math.min(86400000, 60000 * 2 ** Math.min(row.attempts, 10)),
        ),
        claimId: null,
        claimedAt: null,
      })
      .where(
        and(
          eq(authIntegrationRevocations.id, row.id),
          eq(authIntegrationRevocations.claimId, claimId),
        ),
      );
  }
}

export async function registerAuthMailWorker(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(AUTH_MAINTENANCE_QUEUE);
  await boss.schedule(AUTH_MAINTENANCE_QUEUE, "* * * * *");
  await boss.work(AUTH_MAINTENANCE_QUEUE, async () => {
    const signal = AbortSignal.timeout(60_000);
    await dispatchAuthMail(db, signal);
    await dispatchIntegrationRevocations(db, signal);
    await expireAuthenticationRecords(db, signal);
    await pruneMailboxProofs(db, signal);
    await pruneAuthRateLimits(db, signal);
    await pruneTotpReplays(db, signal);
    await pruneEmailVerificationTokens(db, signal);
  });
}
