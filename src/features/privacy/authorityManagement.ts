import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { privacyAuthority, privacyCaseMembers, privacyCases, users } from "@/db/schema";
import { lockAuthAccount } from "@/features/auth/better/accountLock";
import { recordSecurityEvent } from "@/features/auth/management/audit";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { err, ok, type Result } from "@/types/result";
import type { PrivacyActor } from "./authoritySession";
import { privacyCapabilitiesSchema } from "./capabilities";
import { withPrivacyAuthority } from "./permissions";

const authorityInput = z.strictObject({
  userId: z.uuid(),
  capabilities: privacyCapabilitiesSchema,
});
const memberInput = authorityInput.extend({ caseId: z.uuid() });
type AuthorityInput = z.infer<typeof authorityInput>;
type ManagementResult = Result<true, "forbidden" | "invalid_input">;

// Lock every involved account before the common grant/user locks. Never upgrade case locks into account locks.
async function manageAuthority(
  db: Db,
  actor: PrivacyActor,
  input: AuthorityInput,
  signal: AbortSignal,
  effect: (tx: Db) => Promise<ManagementResult>,
): Promise<ManagementResult> {
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    const owners = [...new Set([actor.userId, input.userId])].sort();
    for (const owner of owners) await lockAuthAccount(tx, owner, signal);
    await lockMcpGrants(tx, signal);
    const actors = await tx
      .select()
      .from(users)
      .where(inArray(users.id, owners))
      .orderBy(users.id)
      .for("no key update");
    signal.throwIfAborted();
    const target = actors.find((user) => user.id === input.userId);
    if (target === undefined || !target.isActive || target.invitedAt !== null)
      return err("forbidden");
    return withPrivacyAuthority(
      tx,
      actor,
      { capability: "authority.manage" },
      signal,
      async (guarded) => {
        const [authority] = await guarded
          .select()
          .from(privacyAuthority)
          .where(eq(privacyAuthority.userId, actor.userId));
        signal.throwIfAborted();
        if (
          authority === undefined ||
          input.capabilities.some((capability) => !authority.capabilities.includes(capability))
        )
          return err("forbidden");
        return effect(guarded);
      },
    );
  });
}

export async function replacePrivacyAuthority(
  db: Db,
  actor: PrivacyActor,
  raw: unknown,
  signal: AbortSignal,
): Promise<ManagementResult> {
  const parsed = authorityInput.safeParse(raw);
  if (!parsed.success) return err("invalid_input");
  const input = parsed.data;
  return manageAuthority(db, actor, input, signal, async (tx) => {
    await tx
      .insert(privacyAuthority)
      .values({ userId: input.userId, capabilities: input.capabilities, updatedBy: actor.userId })
      .onConflictDoUpdate({
        target: privacyAuthority.userId,
        set: {
          capabilities: input.capabilities,
          generation: sql`${privacyAuthority.generation} + 1`,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        },
      });
    await recordSecurityEvent(
      tx,
      {
        actorId: actor.userId,
        targetUserId: input.userId,
        action: "privacy.authority.replace",
        outcome: "success",
        metadata: { count: input.capabilities.length, changed: true },
      },
      signal,
    );
    return ok(true);
  });
}

export async function replacePrivacyCaseMember(
  db: Db,
  actor: PrivacyActor,
  raw: unknown,
  signal: AbortSignal,
): Promise<ManagementResult> {
  const parsed = memberInput.safeParse(raw);
  if (!parsed.success) return err("invalid_input");
  const input = parsed.data;
  return manageAuthority(db, actor, input, signal, async (tx) => {
    const [targetAuthority] = await tx
      .select()
      .from(privacyAuthority)
      .where(eq(privacyAuthority.userId, input.userId))
      .for("no key update");
    signal.throwIfAborted();
    if (
      targetAuthority === undefined ||
      input.capabilities.some((capability) => !targetAuthority.capabilities.includes(capability))
    )
      return err("forbidden");
    const [privacyCase] = await tx
      .select({ id: privacyCases.id })
      .from(privacyCases)
      .where(eq(privacyCases.id, input.caseId))
      .for("no key update");
    signal.throwIfAborted();
    if (privacyCase === undefined) return err("forbidden");
    const [manager] = await tx
      .select()
      .from(privacyCaseMembers)
      .where(
        and(
          eq(privacyCaseMembers.caseId, input.caseId),
          eq(privacyCaseMembers.userId, actor.userId),
        ),
      )
      .for("no key update");
    signal.throwIfAborted();
    if (
      manager === undefined ||
      manager.revokedAt !== null ||
      !manager.capabilities.includes("authority.manage") ||
      input.capabilities.some((capability) => !manager.capabilities.includes(capability))
    )
      return err("forbidden");
    await tx
      .insert(privacyCaseMembers)
      .values({ caseId: input.caseId, userId: input.userId, capabilities: input.capabilities })
      .onConflictDoUpdate({
        target: [privacyCaseMembers.caseId, privacyCaseMembers.userId],
        set: {
          capabilities: input.capabilities,
          generation: sql`${privacyCaseMembers.generation} + 1`,
          revokedAt: null,
        },
      });
    await recordSecurityEvent(
      tx,
      {
        actorId: actor.userId,
        targetUserId: input.userId,
        action: "privacy.case_member.replace",
        outcome: "success",
        metadata: { count: input.capabilities.length, changed: true },
      },
      signal,
    );
    return ok(true);
  });
}
