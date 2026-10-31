import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { authUsers, users } from "@/db/schema";
import { authRecoveryRequests } from "@/db/schema/authManagement";
import { lockAuthAccount } from "@/features/auth/better/accountLock";
import { err, ok, type Result } from "@/types/result";
import { recordSecurityEvent } from "./audit";
import type { ApprovedRecoveryInput } from "./operatorRecovery";

export interface OperatorRecoveryInput extends ApprovedRecoveryInput {
  ownershipConfirmed?: boolean;
}
type EmergencyError =
  | "confirmation_required"
  | "ownership_confirmation_required"
  | "not_pending"
  | "forbidden"
  | "owner_not_verified";

// Host-only review inside the caller's recovery transaction. Flags attest a HUMAN ownership
// investigation; they are not identity verification and are never accepted from a browser route.
export async function reviewEmergencyRecovery(
  db: Db,
  input: OperatorRecoveryInput,
  signal: AbortSignal,
): Promise<Result<true, EmergencyError>> {
  signal.throwIfAborted();
  if (input.operatorConfirmed !== true || input.emergencyLastAdministrator !== true)
    return err("confirmation_required");
  if (input.ownershipConfirmed !== true) return err("ownership_confirmation_required");
  const [candidate] = await db
    .select()
    .from(authRecoveryRequests)
    .where(eq(authRecoveryRequests.id, input.requestId));
  signal.throwIfAborted();
  if (
    candidate === undefined ||
    candidate.kind !== "factor_recovery" ||
    candidate.status !== "pending"
  )
    return err("not_pending");
  await lockAuthAccount(db, candidate.userId, signal);
  const administrators = await db
    .select()
    .from(users)
    .where(and(eq(users.isAdmin, true), eq(users.isActive, true), isNull(users.invitedAt)))
    .orderBy(users.id)
    .for("no key update");
  signal.throwIfAborted();
  const owner = administrators[0];
  if (administrators.length !== 1 || owner?.id !== candidate.userId) return err("forbidden");
  const [identity] = await db
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, owner.id))
    .for("no key update");
  signal.throwIfAborted();
  if (
    identity === undefined ||
    !identity.emailVerified ||
    owner.email.toLowerCase() !== identity.email.toLowerCase()
  )
    return err("owner_not_verified");
  const [request] = await db
    .select()
    .from(authRecoveryRequests)
    .where(eq(authRecoveryRequests.id, candidate.id))
    .for("update");
  signal.throwIfAborted();
  if (
    request === undefined ||
    request.kind !== "factor_recovery" ||
    request.status !== "pending" ||
    request.userId !== owner.id
  )
    return err("not_pending");
  await db
    .update(authRecoveryRequests)
    .set({ status: "approved", reviewedBy: owner.id, reviewedAt: new Date() })
    .where(eq(authRecoveryRequests.id, request.id));
  await recordSecurityEvent(
    db,
    {
      actorId: null,
      targetUserId: owner.id,
      action: "recovery.emergency_review",
      outcome: "success",
      metadata: { method: "operator_ownership_attested", changed: true },
    },
    signal,
  );
  return ok(true);
}
