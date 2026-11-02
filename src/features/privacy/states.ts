import { z } from "zod";
import { err, ok, type Result } from "@/types/result";

export const privacyCaseStatusSchema = z.enum([
  "received",
  "verification_needed",
  "under_review",
  "action_approved",
  "running",
  "needs_attention",
  "refused",
  "response_ready",
  "responded",
  "closed",
  "cancelled",
]);
export type PrivacyCaseStatus = z.infer<typeof privacyCaseStatusSchema>;
interface TransitionFacts {
  verified: boolean;
  approvalCurrent: boolean;
  pendingJobs: number;
  failedJobs: number;
  unresolvedObligations: number;
  responseRecorded: boolean;
  refusalRecorded: boolean;
  resultsVerified: boolean;
}
type TransitionFailure =
  | "invalid_transition"
  | "verification_required"
  | "approval_required"
  | "work_unresolved"
  | "response_required"
  | "decision_required";
const NEXT: Record<PrivacyCaseStatus, readonly PrivacyCaseStatus[]> = {
  received: ["verification_needed", "cancelled"],
  verification_needed: ["under_review", "cancelled"],
  under_review: ["action_approved", "refused", "verification_needed", "cancelled"],
  action_approved: ["running", "under_review", "needs_attention"],
  running: ["response_ready", "needs_attention"],
  needs_attention: ["under_review", "verification_needed", "cancelled"],
  refused: ["response_ready", "under_review"],
  response_ready: ["responded", "needs_attention"],
  responded: ["closed", "needs_attention"],
  closed: [],
  cancelled: [],
};

export function validateCaseTransition(
  from: PrivacyCaseStatus,
  to: PrivacyCaseStatus,
  facts: TransitionFacts,
): Result<true, TransitionFailure> {
  if (!NEXT[from].includes(to)) return err("invalid_transition");
  if ((to === "under_review" || to === "action_approved" || to === "running") && !facts.verified)
    return err("verification_required");
  if ((to === "action_approved" || to === "running") && !facts.approvalCurrent)
    return err("approval_required");
  if (to === "refused" && !facts.refusalRecorded) return err("decision_required");
  if (
    (to === "response_ready" || to === "closed") &&
    (facts.pendingJobs > 0 ||
      facts.failedJobs > 0 ||
      facts.unresolvedObligations > 0 ||
      !facts.resultsVerified)
  )
    return err("work_unresolved");
  if ((to === "responded" || to === "closed") && !facts.responseRecorded)
    return err("response_required");
  return ok(true);
}
