import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { authPolicies } from "@/db/schema/authManagement";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { recordSecurityEvent } from "./audit";
import { type AuthPolicy, DEFAULT_AUTH_POLICY } from "./domain";
import { lockMcpGrants, revokeMcpGrants } from "./mcpGrants";

export async function readAuthPolicy(db: Db, signal: AbortSignal): Promise<AuthPolicy> {
  signal.throwIfAborted();
  const [policy] = await db.select().from(authPolicies).where(eq(authPolicies.id, true)).limit(1);
  signal.throwIfAborted();
  return policy === undefined
    ? { ...DEFAULT_AUTH_POLICY }
    : {
        requireMfaForAll: policy.requireMfaForAll,
        idleMinutes: policy.idleMinutes,
        absoluteHours: policy.absoluteHours,
        freshMinutes: policy.freshMinutes,
      };
}

export async function updateAuthPolicy(
  db: Db,
  actor: PermSetUser,
  policy: AuthPolicy,
  signal: AbortSignal,
): Promise<Result<true, "forbidden">> {
  if (!actor.isActive || actor.type !== "admin") return err("forbidden");
  signal.throwIfAborted();
  await db.transaction(async (tx) => {
    await lockMcpGrants(tx, signal);
    const previous = await readAuthPolicy(tx, signal);
    await tx
      .insert(authPolicies)
      .values({ id: true, ...policy, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: authPolicies.id,
        set: { ...policy, updatedBy: actor.id, updatedAt: new Date() },
      });
    if (!previous.requireMfaForAll && policy.requireMfaForAll)
      await revokeMcpGrants(tx, null, signal);
    await recordSecurityEvent(
      tx,
      {
        actorId: actor.id,
        action: "policy.update",
        outcome: "success",
        metadata: { changed: true },
      },
      signal,
    );
  });
  return ok(true);
}
