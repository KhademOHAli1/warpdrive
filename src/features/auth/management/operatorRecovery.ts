import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { authAccounts, authPasskeys, authTwoFactors, authUsers, users } from "@/db/schema";
import { authRecoveryRequests } from "@/db/schema/authManagement";
import { lockAuthAccount } from "@/features/auth/better/accountLock";
import { err, ok, type Result } from "@/types/result";
import { recordSecurityEvent } from "./audit";
import { lockMcpGrants } from "./mcpGrants";
import { enqueueUserSecurityNotice } from "./notices";
import { revokeUserAccess } from "./offboarding";

export interface ApprovedRecoveryInput {
  requestId: string;
  operatorConfirmed: boolean;
  emergencyLastAdministrator?: boolean;
}

type RecoveryError = "confirmation_required" | "not_approved" | "forbidden" | "owner_not_verified";

// Only a host operator can invoke this service after checking the reviewed ownership evidence.
// There is deliberately no HTTP route: an authenticated browser is not ownership evidence.
export async function completeApprovedRecovery(
  db: Db,
  input: ApprovedRecoveryInput,
  signal: AbortSignal,
): Promise<Result<{ userId: string; email: string }, RecoveryError>> {
  signal.throwIfAborted();
  if (!input.operatorConfirmed) return err("confirmation_required");
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(authRecoveryRequests)
      .where(eq(authRecoveryRequests.id, input.requestId));
    if (
      candidate === undefined ||
      candidate.kind !== "factor_recovery" ||
      candidate.status !== "approved"
    )
      return err("not_approved");

    await lockAuthAccount(tx, candidate.userId, signal);
    await lockMcpGrants(tx, signal);

    // Match the existing administrator lock order before locking the owner or any factor rows.
    const administrators = await tx
      .select()
      .from(users)
      .where(and(eq(users.isAdmin, true), eq(users.isActive, true), isNull(users.invitedAt)))
      .orderBy(users.id)
      .for("no key update");
    const [owner] = await tx
      .select()
      .from(users)
      .where(eq(users.id, candidate.userId))
      .for("no key update");
    const [identity] = await tx
      .select()
      .from(authUsers)
      .where(eq(authUsers.id, candidate.userId))
      .for("no key update");
    // Lock cases only after their owner, so two approved cases cannot form a lock cycle.
    const [request] = await tx
      .select()
      .from(authRecoveryRequests)
      .where(eq(authRecoveryRequests.id, candidate.id))
      .for("update");
    if (
      request === undefined ||
      request.kind !== "factor_recovery" ||
      request.status !== "approved" ||
      request.userId !== candidate.userId ||
      request.reviewedBy === null ||
      request.reviewedAt === null
    )
      return err("not_approved");
    const reviewer = administrators.find((user) => user.id === request.reviewedBy);
    if (reviewer === undefined) return err("forbidden");
    const selfReviewed = request.reviewedBy === request.userId;
    if (
      selfReviewed &&
      !(
        input.emergencyLastAdministrator === true &&
        administrators.length === 1 &&
        administrators[0]?.id === request.userId
      )
    )
      return err("forbidden");

    signal.throwIfAborted();
    if (
      owner === undefined ||
      !owner.isActive ||
      owner.invitedAt !== null ||
      identity === undefined ||
      !identity.emailVerified ||
      owner.email.toLowerCase() !== identity.email.toLowerCase()
    )
      return err("owner_not_verified");

    await tx
      .select({ id: authTwoFactors.id })
      .from(authTwoFactors)
      .where(eq(authTwoFactors.userId, owner.id))
      .for("update");
    await tx
      .select({ id: authPasskeys.id })
      .from(authPasskeys)
      .where(eq(authPasskeys.userId, owner.id))
      .orderBy(authPasskeys.id)
      .for("update");
    await tx.delete(authTwoFactors).where(eq(authTwoFactors.userId, owner.id));
    await tx.delete(authPasskeys).where(eq(authPasskeys.userId, owner.id));
    const now = new Date();
    await tx
      .update(authUsers)
      .set({ twoFactorEnabled: false, updatedAt: now })
      .where(eq(authUsers.id, owner.id));
    // Keep provider subjects and password hashes, but discard reusable integration credentials.
    await tx
      .update(authAccounts)
      .set({
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(authAccounts.userId, owner.id));
    await revokeUserAccess(tx, owner.id, signal);
    await tx
      .update(authRecoveryRequests)
      .set({ status: "resolved" })
      .where(eq(authRecoveryRequests.id, request.id));
    // Older open requests must not become a second recovery grant after this one is resolved.
    await tx
      .update(authRecoveryRequests)
      .set({ status: "rejected" })
      .where(
        and(
          eq(authRecoveryRequests.userId, owner.id),
          eq(authRecoveryRequests.kind, "factor_recovery"),
          inArray(authRecoveryRequests.status, ["pending", "approved"]),
        ),
      );
    await recordSecurityEvent(
      tx,
      {
        actorId: reviewer.id,
        targetUserId: owner.id,
        action: "recovery.complete",
        outcome: "success",
        metadata: {
          method: selfReviewed ? "operator_emergency" : "operator_review",
          changed: true,
        },
      },
      signal,
    );
    await enqueueUserSecurityNotice(tx, owner.id, "operator_recovery", signal);
    return ok({ userId: owner.id, email: identity.email });
  });
}
