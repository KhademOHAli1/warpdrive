import { z } from "zod";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import type { transitionPrivacyCaseAction } from "../reviewerActions";
import type {
  ReviewerClaimIntent,
  ReviewerClaimReceipt,
  ReviewerIntakeCardProps,
} from "./reviewerIntakeModel";

type TransitionOutcome = Awaited<ReturnType<typeof transitionPrivacyCaseAction>>;
export type ReviewerVerificationStartReceipt = Pick<
  Extract<TransitionOutcome, { ok: true }>["value"],
  "id" | "version" | "status"
>;
export type ReviewerVerificationStartError =
  | Extract<TransitionOutcome, { ok: false }>["error"]
  | "email_verification_required"
  | "security_unavailable"
  | "transport_interrupted";
export type ReviewerVerificationStartIntent = Readonly<{
  caseId: string;
  expectedVersion: number;
  commandId: string;
  toStatus: "verification_needed";
}>;
export interface ReviewerVerificationStartProps extends ReviewerIntakeCardProps {
  claimReceipt: ReviewerClaimReceipt | null;
  claimIntent: ReviewerClaimIntent | null;
  parentDenial: ReviewerVerificationParentDenial;
  onInvalidate?: (reason: "account_changed" | "signed_out") => void;
  onDeny?: (reason: ReviewerVerificationDenial) => void;
}
export type ReviewerVerificationDenial =
  | "forbidden"
  | "fresh_auth_required"
  | "email_verification_required"
  | "security_unavailable";
export interface ReviewerVerificationParentDenial {
  epoch: number;
  reason: ReviewerVerificationDenial | null;
}
export interface ReviewerVerificationStartView {
  boundary: string;
  parentDenialEpoch: number;
  epoch: number;
  consumedClaim: string | null;
  phase: "idle" | "prepared" | "pending" | "uncertain" | "recorded" | "rejected";
  intent: ReviewerVerificationStartIntent | null;
  receipt: ReviewerVerificationStartReceipt | null;
  error: ReviewerVerificationStartError | null;
  blocked: "account_changed" | "signed_out" | null;
  busy: boolean;
}
export interface ReviewerVerificationStartTask extends ReviewerVerificationStartView {
  canStart: boolean;
  canRetry: boolean;
  canClear: boolean;
  locksClaim: boolean;
  start: () => void;
  retry: () => void;
  clear: () => void;
}

export function emptyVerificationStart(
  boundary: string,
  parentDenialEpoch = 0,
): ReviewerVerificationStartView {
  return {
    boundary,
    parentDenialEpoch,
    epoch: 0,
    consumedClaim: null,
    phase: "idle",
    intent: null,
    receipt: null,
    error: null,
    blocked: null,
    busy: false,
  };
}
export function verificationBoundary(props: ReviewerVerificationStartProps) {
  const status = props.securityStatus;
  return JSON.stringify([
    status.user.id,
    status.emailVerified,
    status.fresh,
    status.needsMfa,
    status.needsEnrollment,
    props.securityUnavailable === true,
    props.parentDenial.epoch,
  ]);
}
export function verificationSecurityError(
  status: SecurityStatus,
  reviewerId: string,
  unavailable = false,
): ReviewerVerificationStartError | null {
  if (status.user.id !== reviewerId) return "reviewer_changed";
  if (unavailable) return "security_unavailable";
  if (!status.emailVerified) return "email_verification_required";
  if (!status.fresh || status.needsMfa || status.needsEnrollment) return "fresh_auth_required";
  return null;
}
const referenceSchema = z.uuid();
export function verificationClaimKey(props: ReviewerVerificationStartProps): string | null {
  const receipt = props.claimReceipt;
  const intent = props.claimIntent;
  if (
    receipt === null ||
    intent === null ||
    receipt.status !== "received" ||
    receipt.id !== intent.caseId ||
    !referenceSchema.safeParse(receipt.id).success ||
    !Number.isSafeInteger(intent.expectedVersion) ||
    intent.expectedVersion < 0 ||
    !Number.isSafeInteger(receipt.version) ||
    receipt.version !== intent.expectedVersion + 1
  )
    return null;
  return `${receipt.id}:${receipt.version}`;
}
const receiptSchema = z.object({
  id: z.uuid(),
  version: z.number().int().nonnegative(),
  status: z.literal("verification_needed"),
});
export function verificationReceipt(
  value: unknown,
  intent: ReviewerVerificationStartIntent,
): ReviewerVerificationStartReceipt | null {
  const parsed = receiptSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.id !== intent.caseId ||
    parsed.data.version !== intent.expectedVersion + 1
  )
    return null;
  return parsed.data;
}
const failures = [
  "invalid_input",
  "csrf_rejected",
  "fresh_auth_required",
  "reviewer_changed",
  "request_failed",
  "forbidden",
  "stale_version",
  "idempotency_conflict",
  "storage_unavailable",
  "invalid_transition",
  "verification_required",
  "approval_required",
  "work_unresolved",
  "response_required",
  "decision_required",
  "email_verification_required",
  "security_unavailable",
  "transport_interrupted",
] as const;
export function verificationFailure(value: unknown): ReviewerVerificationStartError {
  return failures.find((failure) => failure === value) ?? "request_failed";
}
export function verificationDenial(
  error: ReviewerVerificationStartError,
): ReviewerVerificationDenial | null {
  return error === "forbidden" ||
    error === "fresh_auth_required" ||
    error === "email_verification_required" ||
    error === "security_unavailable"
    ? error
    : null;
}
export function verificationRejected(error: ReviewerVerificationStartError) {
  return [
    "invalid_input",
    "stale_version",
    "idempotency_conflict",
    "invalid_transition",
    "verification_required",
    "approval_required",
    "work_unresolved",
    "response_required",
    "decision_required",
  ].includes(error);
}
