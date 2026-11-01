import type { SecurityStatus } from "@/features/auth/better/contracts";
import type { Result } from "@/types/result";
import type { claimPrivacyCaseAction, listPrivacyIntakeQueueAction } from "../reviewerActions";

type QueueOutcome = Awaited<ReturnType<typeof listPrivacyIntakeQueueAction>>;
type ClaimOutcome = Awaited<ReturnType<typeof claimPrivacyCaseAction>>;
export type ReviewerIntakeRow = Extract<QueueOutcome, { ok: true }>["value"]["items"][number];
export type ReviewerClaimReceipt = Extract<ClaimOutcome, { ok: true }>["value"];
export type ReviewerIntakeError =
  | Extract<QueueOutcome | ClaimOutcome, { ok: false }>["error"]
  | "security_unavailable"
  | "transport_interrupted";
export type ReviewerClaimIntent = Readonly<{
  caseId: string;
  expectedVersion: number;
  commandId: string;
}>;
export interface ReviewerIntakeCardProps {
  securityStatus: SecurityStatus;
  refreshSecurity: (signal: AbortSignal) => Promise<Result<SecurityStatus | null, "unavailable">>;
  securityUnavailable?: boolean;
}
export interface ReviewerIntakeView {
  rows: ReviewerIntakeRow[];
  cursor: string | null;
  loaded: boolean;
  engaged: boolean;
  busy: boolean;
  error: ReviewerIntakeError | null;
  intent: ReviewerClaimIntent | null;
  claimState: "idle" | "prepared" | "pending" | "uncertain" | "recorded" | "rejected";
  receipt: ReviewerClaimReceipt | null;
}
export const reviewerIsFresh = (status: SecurityStatus) =>
  status.fresh && !status.needsMfa && !status.needsEnrollment;
export function emptyReviewerIntake(): ReviewerIntakeView {
  return {
    rows: [],
    cursor: null,
    loaded: false,
    engaged: false,
    busy: false,
    error: null,
    intent: null,
    claimState: "idle",
    receipt: null,
  };
}
export function isDefinitiveClaimFailure(error: ReviewerIntakeError): boolean {
  return [
    "invalid_input",
    "not_found",
    "stale_version",
    "case_assigned",
    "case_not_assignable",
    "idempotency_conflict",
  ].includes(error);
}
export function hideQueueForFailure(error: ReviewerIntakeError): boolean {
  return (
    ["forbidden", "fresh_auth_required", "reviewer_changed", "security_unavailable"].includes(
      error,
    ) || isDefinitiveClaimFailure(error)
  );
}
