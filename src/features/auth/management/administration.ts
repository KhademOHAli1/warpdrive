import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { activities, deals, leads, organizations, persons, users } from "@/db/schema";
import { authRecoveryRequests } from "@/db/schema/authManagement";
import { lockAuthAccount } from "@/features/auth/better/accountLock";
import type { Locale } from "@/features/i18n/registry";
import { setUserActive } from "@/features/identity/users.service";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { recordSecurityEvent } from "./audit";
import { enqueueAuthMail } from "./mail";
import { lockMcpGrants } from "./mcpGrants";
import { enqueueUserSecurityNotice } from "./notices";
import { revokeUserAccess } from "./offboarding";

export async function createRecoveryRequest(
  db: Db,
  userId: string,
  kind: "factor_recovery" | "account_closure",
  locale: Locale,
  signal: AbortSignal,
): Promise<Result<{ id: string }, "not_found">> {
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (user === undefined || !user.isActive) return err("not_found");
    const [existing] = await tx
      .select({ id: authRecoveryRequests.id })
      .from(authRecoveryRequests)
      .where(
        and(
          eq(authRecoveryRequests.userId, userId),
          eq(authRecoveryRequests.kind, kind),
          eq(authRecoveryRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (existing !== undefined) return ok(existing);
    const [request] = await tx
      .insert(authRecoveryRequests)
      .values({ userId, kind })
      .returning({ id: authRecoveryRequests.id });
    if (request === undefined) return err("not_found");
    await recordSecurityEvent(
      tx,
      {
        actorId: userId,
        targetUserId: userId,
        action: kind === "factor_recovery" ? "recovery.request" : "account.closure_request",
        outcome: "success",
      },
      signal,
    );
    await enqueueAuthMail(
      tx,
      {
        userId,
        recipient: user.email,
        locale,
        kind: kind === "factor_recovery" ? "recovery" : "security_change",
      },
      signal,
    );
    return ok(request);
  });
}

// Reviewing a case is not a factor reset. The operator must follow the ownership-verification runbook.
export async function reviewRecoveryRequest(
  db: Db,
  actor: PermSetUser,
  id: string,
  status: "approved" | "rejected" | "resolved",
  signal: AbortSignal,
): Promise<Result<true, string>> {
  if (!actor.isActive || actor.type !== "admin") return err("forbidden");
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(authRecoveryRequests)
      .where(eq(authRecoveryRequests.id, id))
      .for("update");
    if (request === undefined || request.status === "resolved" || request.status === "rejected")
      return err("not_found");
    if (request.kind === "factor_recovery" && request.userId === actor.id) return err("forbidden");
    if (status === "resolved") {
      if (request.kind !== "account_closure" || request.status !== "approved")
        return err("forbidden");
      const suspended = await setUserActive(
        tx,
        actor,
        { userId: request.userId, isActive: false },
        signal,
      );
      if (!suspended.ok) return suspended;
    }
    await tx
      .update(authRecoveryRequests)
      .set({ status, reviewedBy: actor.id, reviewedAt: new Date() })
      .where(eq(authRecoveryRequests.id, id));
    await recordSecurityEvent(
      tx,
      {
        actorId: actor.id,
        targetUserId: request.userId,
        action: "recovery.review",
        outcome: "success",
        metadata: { operation: status },
      },
      signal,
    );
    return ok(true);
  });
}

export async function revokeManagedUserAccess(
  db: Db,
  actor: PermSetUser,
  userId: string,
  signal: AbortSignal,
): Promise<Result<true, "forbidden" | "not_found">> {
  if (!actor.isActive || actor.type !== "admin") return err("forbidden");
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    await lockAuthAccount(tx, userId, signal);
    await lockMcpGrants(tx, signal);
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (user === undefined) return err("not_found");
    await revokeUserAccess(tx, userId, signal);
    await recordSecurityEvent(
      tx,
      { actorId: actor.id, targetUserId: userId, action: "user.revoke_access", outcome: "success" },
      signal,
    );
    await enqueueUserSecurityNotice(tx, userId, "admin_sessions", signal);
    return ok(true);
  });
}

export async function transferUserOwnership(
  db: Db,
  actor: PermSetUser,
  fromUserId: string,
  toUserId: string,
  signal: AbortSignal,
): Promise<Result<true, "forbidden" | "invalid_transfer">> {
  if (!actor.isActive || actor.type !== "admin") return err("forbidden");
  if (fromUserId === toUserId) return err("invalid_transfer");
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    const records = await tx
      .select()
      .from(users)
      .where(inArray(users.id, [fromUserId, toUserId]))
      .orderBy(users.id)
      .for("update");
    if (records.length !== 2 || records.find((user) => user.id === toUserId)?.isActive !== true)
      return err("invalid_transfer");
    for (const table of [deals, leads, persons, organizations, activities]) {
      await tx.update(table).set({ ownerId: toUserId }).where(eq(table.ownerId, fromUserId));
    }
    await tx
      .update(activities)
      .set({ assigneeId: toUserId })
      .where(eq(activities.assigneeId, fromUserId));
    await recordSecurityEvent(
      tx,
      {
        actorId: actor.id,
        targetUserId: fromUserId,
        action: "user.transfer_ownership",
        outcome: "success",
        metadata: { changed: true },
      },
      signal,
    );
    return ok(true);
  });
}

export async function expireAuthenticationRecords(db: Db, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  // Expired delivery bodies contain no useful bearer link and need not remain in backups indefinitely.
  await db.execute(
    sql`UPDATE auth_mail_outbox SET payload_enc='\\x'::bytea WHERE status IN ('sent','captured','cancelled') AND created_at < now() - interval '7 days'`,
  );
  await db.execute(
    sql`DELETE FROM auth_security_events WHERE created_at < now() - interval '180 days'`,
  );
  await db.execute(
    sql`DELETE FROM auth_mail_outbox WHERE status IN ('sent','captured','cancelled','failed') AND created_at < now() - interval '180 days'`,
  );
  signal.throwIfAborted();
}
