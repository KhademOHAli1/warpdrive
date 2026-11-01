import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { emailSendAttempts } from "@/db/schema/email";
import { emailDeliveryReviews } from "@/db/schema/emailDeliveryObservations";
import { err, ok, type Result } from "@/types/result";
import { lockDeliveryObservationSession } from "./deliveryObservationAuthority";
import { deliveryObservationReviewInput } from "./deliveryObservationReviewInput";
import { lockDeliveryObservationReport } from "./deliveryObservationScope";
import {
  lockDeliveryObservationAttemptScope,
  readDeliveryObservationTargets,
} from "./deliveryObservationTargets";
import type { DeliveryObservationError, DeliveryReviewState } from "./deliveryObservationTypes";
import type { MailboxActorSession } from "./mailConnectionSchemas";

// A private annotation is append-only. It never changes submission facts or resends mail.
export async function reviewDeliveryReport(
  db: Db,
  context: MailboxActorSession,
  input: unknown,
  signal: AbortSignal,
): Promise<Result<DeliveryReviewState, DeliveryObservationError>> {
  signal.throwIfAborted();
  const parsed = deliveryObservationReviewInput.safeParse(input);
  if (!parsed.success) return err("invalid_input");
  const review = parsed.data;
  const result = await db.transaction(
    async (tx): Promise<Result<DeliveryReviewState, DeliveryObservationError>> => {
      if (!(await lockDeliveryObservationSession(tx, context, signal))) return err("permission");
      const report = await lockDeliveryObservationReport(
        tx,
        context.actorId,
        review.reportId,
        signal,
        true,
      );
      if (report === null) return err("not_found");
      if (report.parsed.recipients[review.recipientIndex] === undefined)
        return err("invalid_input");
      const [latest] = await tx
        .select({ revision: emailDeliveryReviews.revision })
        .from(emailDeliveryReviews)
        .where(
          and(
            eq(emailDeliveryReviews.reportId, report.id),
            eq(emailDeliveryReviews.recipientIndex, review.recipientIndex),
          ),
        )
        .orderBy(desc(emailDeliveryReviews.revision))
        .limit(1);
      signal.throwIfAborted();
      if ((latest?.revision ?? 0) !== review.expectedRevision) return err("conflict");
      const revision = review.expectedRevision + 1;
      let target: DeliveryReviewState["target"] = null;
      let snapshotHash: string | null = null;
      if (review.decision === "associate") {
        if (
          !(await lockDeliveryObservationAttemptScope(
            tx,
            review.target.attemptId,
            report.accountId,
            signal,
          ))
        )
          return err("not_found");
        const [snapshot] = await readDeliveryObservationTargets(
          tx,
          report.accountId,
          signal,
          eq(emailSendAttempts.id, review.target.attemptId),
          1,
        );
        const recipient = snapshot?.target.recipients.find(
          (candidate) => candidate.address === review.target.recipient,
        );
        if (snapshot === undefined || recipient === undefined) return err("invalid_input");
        target = {
          attemptId: review.target.attemptId,
          recipient: recipient.address,
          kind: recipient.kind,
        };
        snapshotHash = snapshot.hash;
      }
      const [inserted] = await tx
        .insert(emailDeliveryReviews)
        .values({
          accountId: report.accountId,
          reportId: report.id,
          recipientIndex: review.recipientIndex,
          revision,
          decision: review.decision,
          attemptId: target?.attemptId ?? null,
          recipientSnapshot:
            target === null ? null : { address: target.recipient, kind: target.kind },
          attemptSnapshotHash: snapshotHash,
          reviewerId: context.actorId,
        })
        .onConflictDoNothing({
          target: [
            emailDeliveryReviews.reportId,
            emailDeliveryReviews.recipientIndex,
            emailDeliveryReviews.revision,
          ],
        })
        .returning({ id: emailDeliveryReviews.id });
      signal.throwIfAborted();
      return inserted === undefined
        ? err("conflict")
        : ok({
            revision,
            decision: review.decision === "dismiss" ? "dismissed" : "associated",
            target,
          });
    },
    { isolationLevel: "read committed" },
  );
  signal.throwIfAborted();
  return result;
}
