import type { Result } from "@/types/result";

export type PrivateIntakeProvider = "gmail" | "imap_smtp";
export type PrivateIntakeState = "unverified" | "confirmed_notification" | "conflict";
export type PrivateIntakeContentState = "retained" | "purged";
export type PrivateIntakeReviewDecision = "keep_private" | "dismiss" | "restore_private";

export interface PrivateIntakeSummary {
  id: string;
  revision: number;
  state: PrivateIntakeState;
  contentState: PrivateIntakeContentState;
  decision: PrivateIntakeReviewDecision | null;
}

export interface PrivateIntakeReviewInput {
  intakeId: string;
  expectedRevision: number;
  decision: PrivateIntakeReviewDecision;
}

export type PrivateIntakeReviewError = "not_found" | "conflict" | "forbidden" | "unavailable";
export type PrivateIntakeReviewResult = Result<PrivateIntakeSummary, PrivateIntakeReviewError>;

// This is a retained confirmation fact, not public-header correlation input.
export interface PrivateIntakeConfirmationSnapshot {
  version: 1;
  accountId: string;
  attemptId: string;
  providerMessageId: string;
  payloadHash: string;
}
