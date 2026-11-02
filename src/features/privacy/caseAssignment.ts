import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { privacyAuthority, privacyCaseEvents, privacyCaseMembers, privacyCases } from "@/db/schema";
import { err, ok } from "@/types/result";
import { PRIVACY_CAPABILITIES, privacyCapabilitiesSchema } from "./capabilities";
import { unassignedIntakeCondition } from "./caseAssignmentEligibility";
import { readCaseClaimReceipt } from "./caseAssignmentReceipt";
import { privacyStorageOperation } from "./casePersistence";
import { type PrivacyActor, withPrivacyAuthority } from "./permissions";

const claimSchema = z.strictObject({
  caseId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  commandId: z.uuid(),
});

// This explicit global triage capability bootstraps only a newly received, unassigned case.
// Subsequent delegation uses case-specific authority.manage, never a global takeover.
export async function claimPrivacyCase(
  db: Db,
  actor: PrivacyActor,
  raw: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const parsed = claimSchema.safeParse(raw);
  if (!parsed.success) return err("invalid_input" as const);
  const input = parsed.data;
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(db, actor, { capability: "case.assign" }, signal, async (tx) => {
      const [authority] = await tx
        .select()
        .from(privacyAuthority)
        .where(eq(privacyAuthority.userId, actor.userId));
      signal.throwIfAborted();
      const current = privacyCapabilitiesSchema.safeParse(authority?.capabilities);
      if (
        !current.success ||
        !current.data.includes("authority.manage") ||
        !current.data.includes("case.review")
      )
        return err("forbidden" as const);
      const [row] = await tx
        .select()
        .from(privacyCases)
        .where(eq(privacyCases.id, input.caseId))
        .for("no key update");
      signal.throwIfAborted();
      if (row === undefined) return err("not_found" as const);
      const replay = await readCaseClaimReceipt(tx, actor, input, signal);
      if (replay !== null) return replay;
      if (row.version !== input.expectedVersion) return err("stale_version" as const);
      if (row.status !== "received" && row.status !== "verification_needed")
        return err("case_not_assignable" as const);
      const [available] = await tx
        .select({ id: privacyCases.id })
        .from(privacyCases)
        .where(and(eq(privacyCases.id, row.id), unassignedIntakeCondition(tx)));
      signal.throwIfAborted();
      if (available === undefined) return err("case_assigned" as const);
      const capabilities = PRIVACY_CAPABILITIES.filter(
        (capability) =>
          capability !== "case.assign" &&
          capability !== "policy.manage" &&
          current.data.includes(capability),
      );
      await tx
        .insert(privacyCaseMembers)
        .values({ caseId: row.id, userId: actor.userId, capabilities })
        .onConflictDoUpdate({
          target: [privacyCaseMembers.caseId, privacyCaseMembers.userId],
          set: {
            capabilities,
            generation: sql`${privacyCaseMembers.generation} + 1`,
            revokedAt: null,
          },
        });
      const version = row.version + 1;
      await tx
        .update(privacyCases)
        .set({ version, updatedAt: new Date() })
        .where(eq(privacyCases.id, row.id));
      await tx.insert(privacyCaseEvents).values({
        caseId: row.id,
        caseVersion: version,
        commandId: input.commandId,
        actorId: actor.userId,
        action: "case.assigned",
        fromStatus: row.status,
        toStatus: row.status,
      });
      signal.throwIfAborted();
      return ok({ id: row.id, version, status: row.status });
    }),
  );
}
