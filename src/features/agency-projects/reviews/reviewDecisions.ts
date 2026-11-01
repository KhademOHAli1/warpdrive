import { Temporal } from "@js-temporal/polyfill";
import { err, ok, type Result } from "@/types/result";
import { reviewDecisionEntry } from "./reviewDecisionEntry";
import { reviewActionSchema, reviewCommandSchema } from "./reviewSchemas";
import type {
  ReviewAction,
  ReviewApprovals,
  ReviewCommand,
  ReviewDecision,
  ReviewFailure,
  ReviewMutationReceipt,
  ReviewSnapshot,
} from "./reviewTypes";

export type { ReviewSnapshot } from "./reviewTypes";

export function parseReviewAction(input: unknown): Result<ReviewAction, "invalid_review_action"> {
  const parsed = reviewActionSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err("invalid_review_action");
}

export function parseReviewCommand(
  input: unknown,
): Result<ReviewCommand, "invalid_review_command"> {
  const parsed = reviewCommandSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err("invalid_review_command");
}

function conflict(current: ReviewSnapshot, command: ReviewCommand): ReviewFailure | null {
  if (command.expectedRevision !== current.revision) return "revision_conflict";
  if (command.projectId !== current.projectId || command.deliverableId !== current.deliverableId) {
    return "review_target_mismatch";
  }
  if (Temporal.Instant.compare(command.recordedAt, current.lastRecordedAt) < 0) {
    return "review_time_conflict";
  }
  if (command.action === "record-internal-review" || command.action === "record-client-approval") {
    if (command.reviewedVersionReference !== current.currentVersionReference)
      return "review_version_conflict";
    return Temporal.Instant.compare(command.occurredAt, current.reviewOpenedAt) < 0
      ? "review_occurrence_before_epoch"
      : null;
  }
  return command.action === "change-version" &&
    command.versionReference === current.currentVersionReference
    ? "version_unchanged"
    : null;
}

function nextSnapshot(current: ReviewSnapshot, command: ReviewCommand): ReviewSnapshot {
  const revision = current.revision + 1;
  const next = { ...current, revision, lastRecordedAt: command.recordedAt };
  switch (command.action) {
    case "record-internal-review":
    case "record-client-approval":
      return {
        ...next,
        decisions: [...current.decisions, reviewDecisionEntry(current, command, revision)],
      };
    case "change-version":
      return {
        ...next,
        reviewEpoch: current.reviewEpoch + 1,
        reviewOpenedAt: command.recordedAt,
        currentVersionReference: command.versionReference,
      };
    case "reopen-review":
      return { ...next, reviewEpoch: current.reviewEpoch + 1, reviewOpenedAt: command.recordedAt };
  }
}

// Callers supply validated coherent state and enforce native authority and transactional CAS.
export function applyReviewCommand(
  current: ReviewSnapshot,
  command: ReviewCommand,
): Result<Readonly<{ snapshot: ReviewSnapshot; receipt: ReviewMutationReceipt }>, ReviewFailure> {
  const failure = conflict(current, command);
  if (failure !== null) return err(failure);
  if (current.revision >= Number.MAX_SAFE_INTEGER) return err("revision_exhausted");
  const opensReview = command.action === "change-version" || command.action === "reopen-review";
  if (opensReview && current.reviewEpoch >= Number.MAX_SAFE_INTEGER)
    return err("review_epoch_exhausted");
  const snapshot = nextSnapshot(current, command);
  return ok({
    snapshot,
    receipt: {
      policyVersion: 1,
      action: command.action,
      projectId: current.projectId,
      deliverableId: current.deliverableId,
      previousRevision: current.revision,
      revision: snapshot.revision,
      previousReviewEpoch: current.reviewEpoch,
      reviewEpoch: snapshot.reviewEpoch,
      previousReviewOpenedAt: current.reviewOpenedAt,
      reviewOpenedAt: snapshot.reviewOpenedAt,
      previousRecordedAt: current.lastRecordedAt,
      previousVersionReference: current.currentVersionReference,
      versionReference: snapshot.currentVersionReference,
      recordedByUserId: command.recordedByUserId,
      recordedAt: command.recordedAt,
      reason:
        command.action === "change-version" || command.action === "reopen-review"
          ? command.reason
          : null,
    },
  });
}

export function currentReviewApprovals(snapshot: ReviewSnapshot): ReviewApprovals {
  const internal: Extract<ReviewDecision, { kind: "internal-review" }>[] = [];
  const recordedClient: Extract<ReviewDecision, { kind: "staff-recorded-client-approval" }>[] = [];
  for (const decision of snapshot.decisions) {
    if (
      decision.reviewEpoch !== snapshot.reviewEpoch ||
      decision.reviewedVersionReference !== snapshot.currentVersionReference
    )
      continue;
    if (decision.kind === "internal-review") internal.push(decision);
    else recordedClient.push(decision);
  }
  return { internal, recordedClient };
}
