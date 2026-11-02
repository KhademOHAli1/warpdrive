import { and, desc, eq, inArray } from "drizzle-orm";
import { emailSendAttempts } from "@/db/schema/email";
import {
  type EmailDeliveryReportRow,
  type EmailDeliveryReviewRow,
  emailDeliveryReviews,
} from "@/db/schema/emailDeliveryObservations";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { readDeliveryObservationTargets } from "./deliveryObservationTargets";
import type { DeliveryObservationView, DeliveryReviewState } from "./deliveryObservationTypes";

export function deliveryObservationReviewState(
  review: EmailDeliveryReviewRow | undefined,
  available: boolean,
): DeliveryReviewState {
  if (review === undefined) return { revision: 0, decision: "unreviewed", target: null };
  if (review.decision === "dismiss")
    return { revision: review.revision, decision: "dismissed", target: null };
  if (!available || review.attemptId === null || review.recipientSnapshot === null)
    return { revision: review.revision, decision: "unavailable", target: null };
  return {
    revision: review.revision,
    decision: "associated",
    target: {
      attemptId: review.attemptId,
      recipient: review.recipientSnapshot.address,
      kind: review.recipientSnapshot.kind,
    },
  };
}

export async function projectDeliveryObservations(
  tx: DbOrTx,
  accountId: string,
  reports: EmailDeliveryReportRow[],
  signal: AbortSignal,
): Promise<DeliveryObservationView[]> {
  signal.throwIfAborted();
  if (reports.length === 0) return [];
  // Pick the newest verdict before inspecting its target. Filtering earlier can resurrect
  // a previous association when the latest target has disappeared or become unreadable.
  const latest = await tx
    .selectDistinctOn([emailDeliveryReviews.reportId, emailDeliveryReviews.recipientIndex])
    .from(emailDeliveryReviews)
    .where(
      and(
        eq(emailDeliveryReviews.accountId, accountId),
        inArray(
          emailDeliveryReviews.reportId,
          reports.map((report) => report.id),
        ),
      ),
    )
    .orderBy(
      emailDeliveryReviews.reportId,
      emailDeliveryReviews.recipientIndex,
      desc(emailDeliveryReviews.revision),
    );
  signal.throwIfAborted();
  const targetIds = [
    ...new Set(latest.flatMap((review) => (review.attemptId === null ? [] : [review.attemptId]))),
  ];
  const targets =
    targetIds.length === 0
      ? []
      : await readDeliveryObservationTargets(
          tx,
          accountId,
          signal,
          inArray(emailSendAttempts.id, targetIds),
          targetIds.length,
        );
  const targetsById = new Map(targets.map((snapshot) => [snapshot.target.attemptId, snapshot]));
  const reviews = new Map(
    latest.map((review) => [`${review.reportId}:${review.recipientIndex}`, review]),
  );
  return reports.map((report) => ({
    id: report.id,
    sourceMessageId: report.sourceMessageId,
    partKey: report.partKey,
    mediaType: report.mediaType,
    provenance: report.provenance,
    trust: "unverified",
    requiresReview: true,
    recipients: report.parsed.recipients.map((recipient, index) => {
      const review = reviews.get(`${report.id}:${index}`);
      const target =
        review?.attemptId === null || review?.attemptId === undefined
          ? undefined
          : targetsById.get(review.attemptId);
      const snapshot = review?.recipientSnapshot;
      const available =
        target !== undefined &&
        snapshot !== null &&
        snapshot !== undefined &&
        target.hash === review?.attemptSnapshotHash &&
        target.target.recipients.some(
          (candidate) => candidate.address === snapshot.address && candidate.kind === snapshot.kind,
        );
      return { ...recipient, index, review: deliveryObservationReviewState(review, available) };
    }),
  }));
}
