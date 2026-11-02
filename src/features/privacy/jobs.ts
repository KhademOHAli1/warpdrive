import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { privacyCases, privacyJobs } from "@/db/schema";
import { err, ok } from "@/types/result";
import { privacyStorageOperation } from "./casePersistence";
import { type PrivacyActor, withPrivacyAuthority } from "./permissions";

export { claimDiscoveryJob, completeDiscoveryJob } from "./jobLifecycle";

const enqueueSchema = z
  .object({
    caseId: z.uuid(),
    expectedScopeVersion: z.number().int().positive(),
    idempotencyKey: z.uuid(),
  })
  .strict();

// Only non-destructive discovery is enabled here. Destructive jobs require DPL-14's exact approval.
export async function enqueueDiscoveryJob(
  db: Db,
  actor: PrivacyActor,
  input: unknown,
  signal: AbortSignal,
) {
  const parsed = enqueueSchema.safeParse(input);
  if (!parsed.success) return err("invalid_input" as const);
  const command = parsed.data;
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(
      db,
      actor,
      { capability: "case.review", caseId: command.caseId, requireVerifiedSubject: true },
      signal,
      async (tx, ticket) => {
        const [row] = await tx
          .select()
          .from(privacyCases)
          .where(eq(privacyCases.id, command.caseId));
        signal.throwIfAborted();
        if (row === undefined || row.scopeVersion !== command.expectedScopeVersion)
          return err("stale_version" as const);
        if (row.status !== "under_review") return err("invalid_state" as const);
        if (
          ticket.membershipGeneration === null ||
          ticket.scopeVersion === null ||
          ticket.recipientVersion === null ||
          ticket.verificationVersion === null
        )
          return err("forbidden" as const);
        const [existing] = await tx
          .select()
          .from(privacyJobs)
          .where(
            and(
              eq(privacyJobs.caseId, row.id),
              eq(privacyJobs.kind, "discovery"),
              eq(privacyJobs.idempotencyKey, command.idempotencyKey),
            ),
          );
        signal.throwIfAborted();
        if (existing !== undefined)
          return existing.requestedBy === actor.userId &&
            existing.scopeVersion === ticket.scopeVersion
            ? ok({ id: existing.id, status: "queued" as const })
            : err("idempotency_conflict" as const);
        const [created] = await tx
          .insert(privacyJobs)
          .values({
            caseId: row.id,
            kind: "discovery",
            idempotencyKey: command.idempotencyKey,
            requestedBy: actor.userId,
            originatingSessionId: actor.sessionId,
            authorityGeneration: ticket.authorityGeneration,
            memberGeneration: ticket.membershipGeneration,
            scopeVersion: ticket.scopeVersion,
            policyVersion: ticket.policyVersion,
            activePolicyVersion: ticket.activePolicyVersion,
            policyGeneration: ticket.policyGeneration,
            recipientVersion: ticket.recipientVersion,
            verificationVersion: ticket.verificationVersion,
          })
          .returning({ id: privacyJobs.id });
        signal.throwIfAborted();
        return created === undefined
          ? err("storage_unavailable" as const)
          : ok({ id: created.id, status: "queued" as const });
      },
    ),
  );
}
