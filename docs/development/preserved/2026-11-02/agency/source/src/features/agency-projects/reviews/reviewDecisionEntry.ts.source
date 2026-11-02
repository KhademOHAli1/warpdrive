import type { ReviewCommand, ReviewDecision, ReviewSnapshot } from "./reviewTypes";

type RecordCommand = Extract<
  ReviewCommand,
  { action: "record-internal-review" | "record-client-approval" }
>;

export function reviewDecisionEntry(
  current: ReviewSnapshot,
  command: RecordCommand,
  revision: number,
): ReviewDecision {
  const provenance = {
    outcome: command.outcome,
    reviewedVersionReference: command.reviewedVersionReference,
    evidenceReference: command.evidenceReference,
    occurredAt: command.occurredAt,
    recordedByUserId: command.recordedByUserId,
    recordedAt: command.recordedAt,
    reviewEpoch: current.reviewEpoch,
    recordedAtRevision: revision,
  };
  return command.action === "record-client-approval"
    ? {
        ...provenance,
        kind: "staff-recorded-client-approval",
        clientContactId: command.clientContactId,
        method: command.method,
      }
    : { ...provenance, kind: "internal-review", method: command.method };
}
