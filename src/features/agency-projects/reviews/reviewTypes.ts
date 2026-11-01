type Target = Readonly<{
  projectId: string;
  deliverableId: string;
  expectedRevision: number;
}>;
type RecordedEvidence = Readonly<{
  outcome: "approved";
  reviewedVersionReference: string;
  evidenceReference: string;
  occurredAt: string;
}>;
type ClientMethod = "email" | "phone" | "meeting" | "message";

export type ReviewAction = Target & (
  | RecordedEvidence & Readonly<{ action: "record-internal-review"; method: "internal-review" }>
  | RecordedEvidence & Readonly<{
      action: "record-client-approval";
      clientContactId: string;
      method: ClientMethod;
    }>
  | Readonly<{ action: "change-version"; versionReference: string; reason: string }>
  | Readonly<{ action: "reopen-review"; reason: string }>
);
export type ReviewCommand = ReviewAction & Readonly<{
  recordedByUserId: string;
  recordedAt: string;
}>;
type DecisionProvenance = RecordedEvidence & Readonly<{
  recordedByUserId: string;
  recordedAt: string;
  reviewEpoch: number;
  recordedAtRevision: number;
}>;
type InternalDecision = DecisionProvenance & Readonly<{
  kind: "internal-review";
  method: "internal-review";
}>;
type RecordedClientDecision = DecisionProvenance & Readonly<{
  kind: "staff-recorded-client-approval";
  clientContactId: string;
  method: ClientMethod;
}>;
export type ReviewDecision = InternalDecision | RecordedClientDecision;
export type ReviewSnapshot = Readonly<{
  projectId: string;
  deliverableId: string;
  revision: number;
  reviewEpoch: number;
  reviewOpenedAt: string;
  lastRecordedAt: string;
  currentVersionReference: string;
  decisions: readonly ReviewDecision[];
}>;
export type ReviewMutationReceipt = Readonly<{
  policyVersion: 1;
  action: ReviewAction["action"];
  projectId: string;
  deliverableId: string;
  previousRevision: number;
  revision: number;
  previousReviewEpoch: number;
  reviewEpoch: number;
  previousReviewOpenedAt: string;
  reviewOpenedAt: string;
  previousRecordedAt: string;
  previousVersionReference: string;
  versionReference: string;
  recordedByUserId: string;
  recordedAt: string;
  reason: string | null;
}>;
export type ReviewFailure =
  | "revision_conflict"
  | "review_target_mismatch"
  | "review_version_conflict"
  | "version_unchanged"
  | "revision_exhausted"
  | "review_epoch_exhausted"
  | "review_occurrence_before_epoch"
  | "review_time_conflict";
export type ReviewApprovals = Readonly<{
  internal: readonly InternalDecision[];
  recordedClient: readonly RecordedClientDecision[];
}>;
