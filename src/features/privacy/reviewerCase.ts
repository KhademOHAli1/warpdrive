import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { privacyCases } from "@/db/schema";
import { err, ok, type Result } from "@/types/result";
import { currentPrivacySession } from "./authoritySession";
import { privacyStorageOperation } from "./casePersistence";
import { privacyIntakeSchema } from "./caseSchemas";
import { currentCaseIdentityBinding } from "./identityBinding";
import { readIdentityIntake } from "./identityPersistence";
import { type PrivacyActor, withPrivacyAuthority } from "./permissions";
import type { PrivacyReviewerCase, PrivacyReviewerCaseFailure } from "./reviewerCaseTypes";
import { privacyCaseStatusSchema } from "./states";

const selector = z.strictObject({ caseId: z.uuid() });
const finiteDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());

// Review authority reveals the original intake, never a disclosure grant or a substituted proof.
export async function readPrivacyReviewerCase(
  db: Db,
  actor: PrivacyActor,
  input: unknown,
  signal: AbortSignal,
): Promise<Result<PrivacyReviewerCase, PrivacyReviewerCaseFailure>> {
  signal.throwIfAborted();
  const parsed = selector.safeParse(input);
  if (!parsed.success) return err("invalid_input");
  const { caseId } = parsed.data;
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(
      db,
      actor,
      { capability: "case.review", caseId },
      signal,
      async (tx, ticket): Promise<Result<PrivacyReviewerCase, PrivacyReviewerCaseFailure>> => {
        // The case-row lock may have waited past expiry while account/authority locks held.
        if (!(await currentPrivacySession(tx, actor, signal))) return err("forbidden");
        const [row] = await tx.select().from(privacyCases).where(eq(privacyCases.id, caseId));
        signal.throwIfAborted();
        if (row === undefined) return err("forbidden");
        const kind = privacyIntakeSchema.shape.kind.safeParse(row.kind);
        const status = privacyCaseStatusSchema.safeParse(row.status);
        if (
          !kind.success ||
          !status.success ||
          !finiteDate(row.receivedAt) ||
          (row.dueAt !== null && !finiteDate(row.dueAt))
        )
          return err("evidence_unavailable");
        const intake = readIdentityIntake(row);
        if (!intake.ok) return err("evidence_unavailable");
        const current = await currentCaseIdentityBinding(tx, row, signal);
        signal.throwIfAborted();
        return ok({
          formatVersion: 1,
          case: {
            id: row.id,
            kind: kind.data,
            status: status.data,
            version: row.version,
            receivedAt: row.receivedAt.toISOString(),
            dueAt: row.dueAt?.toISOString() ?? null,
            policyVersion: row.policyVersion,
          },
          request: {
            kind: intake.value.kind,
            locale: intake.value.locale,
            subject: intake.value.subject,
            recipient: intake.value.recipient,
            summary: intake.value.summary,
          },
          identity: { state: current ? "current" : "review_required" },
          policy: {
            activeVersion: ticket.activePolicyVersion,
            generation: ticket.policyGeneration,
          },
        });
      },
    ),
  );
}
