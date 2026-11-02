import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { privacyCaseEvents, privacyCases, privacyJobs } from "@/db/schema";
import { err, ok } from "@/types/result";
import { privacyCaseSummary, privacyStorageOperation } from "./casePersistence";
import { privacyTransitionSchema } from "./caseSchemas";
import { decryptPrivacy, encryptPrivacy } from "./crypto";
import { currentCaseIdentityBinding } from "./identityBinding";
import { type PrivacyActor, withPrivacyAuthority } from "./permissions";
import { privacyCaseStatusSchema, validateCaseTransition } from "./states";

export async function transitionPrivacyCase(
  db: Db,
  actor: PrivacyActor,
  input: unknown,
  signal: AbortSignal,
) {
  const parsed = privacyTransitionSchema.safeParse(input);
  if (!parsed.success) return err("invalid_input" as const);
  const command = parsed.data;
  const body = JSON.stringify(command);
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(
      db,
      actor,
      { capability: "case.review", caseId: command.caseId },
      signal,
      async (tx) => {
        const [row] = await tx
          .select()
          .from(privacyCases)
          .where(eq(privacyCases.id, command.caseId));
        signal.throwIfAborted();
        if (row === undefined) return err("forbidden" as const);
        const [event] = await tx
          .select()
          .from(privacyCaseEvents)
          .where(
            and(
              eq(privacyCaseEvents.caseId, row.id),
              eq(privacyCaseEvents.commandId, command.commandId),
            ),
          );
        signal.throwIfAborted();
        if (event !== undefined) {
          const prior =
            event.detailEnc === null
              ? null
              : decryptPrivacy(event.detailEnc, { caseId: row.id, purpose: "decision" });
          if (prior === null || !prior.ok || prior.value !== body || event.actorId !== actor.userId)
            return err("idempotency_conflict" as const);
          return ok({
            ...privacyCaseSummary(row),
            version: event.caseVersion,
            status: event.toStatus,
          });
        }
        if (row.version !== command.expectedVersion) return err("stale_version" as const);
        const [jobs] = await tx
          .select({
            pending:
              sql`count(*) FILTER (WHERE ${privacyJobs.status} IN ('queued','running'))`.mapWith(
                Number,
              ),
            failed:
              sql`count(*) FILTER (WHERE ${privacyJobs.status} IN ('failed','needs_attention'))`.mapWith(
                Number,
              ),
            total: sql`count(*)`.mapWith(Number),
          })
          .from(privacyJobs)
          .where(eq(privacyJobs.caseId, row.id));
        signal.throwIfAborted();
        const from = privacyCaseStatusSchema.safeParse(row.status);
        if (!from.success) return err("invalid_transition" as const);
        const refused = row.status === "refused";
        const valid = validateCaseTransition(from.data, command.toStatus, {
          verified: await currentCaseIdentityBinding(tx, row, signal),
          // DPL-14 owns expiring reviewed approvals. A transition command cannot invent one.
          approvalCurrent: false,
          pendingJobs: jobs?.pending ?? 0,
          failedJobs: jobs?.failed ?? 0,
          unresolvedObligations: row.unresolvedObligations,
          responseRecorded: row.responseRecordedAt !== null,
          refusalRecorded: command.reason !== undefined || refused,
          resultsVerified: refused && jobs?.total === 0,
        });
        if (!valid.ok) return valid;
        const invalidateVerification =
          command.toStatus === "verification_needed" || command.toStatus === "cancelled";
        const [updated] = await tx
          .update(privacyCases)
          .set({
            status: command.toStatus,
            version: row.version + 1,
            updatedAt: new Date(),
            ...(invalidateVerification
              ? { verifiedAt: null, verificationVersion: row.verificationVersion + 1 }
              : {}),
          })
          .where(eq(privacyCases.id, row.id))
          .returning();
        if (updated === undefined) return err("storage_unavailable" as const);
        await tx.insert(privacyCaseEvents).values({
          caseId: row.id,
          caseVersion: updated.version,
          commandId: command.commandId,
          actorId: actor.userId,
          action: "transition",
          fromStatus: row.status,
          toStatus: command.toStatus,
          detailEnc: encryptPrivacy(body, { caseId: row.id, purpose: "decision" }),
        });
        signal.throwIfAborted();
        return ok(privacyCaseSummary(updated));
      },
    ),
  );
}
