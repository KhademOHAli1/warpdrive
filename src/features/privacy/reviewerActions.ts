"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db/client";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { err, type Result } from "@/types/result";
import { claimPrivacyCase } from "./caseAssignment";
import { listPrivacyIntakeQueue } from "./caseAssignmentQueue";
import { transitionPrivacyCase } from "./caseCommands";
import { loadPrivacyNativeSubjectReview } from "./nativeSubjectReview";
import type {
  PrivacyNativeSubjectReview,
  PrivacyNativeSubjectReviewFailure,
} from "./nativeSubjectReviewTypes";
import { readPrivacyReviewerCase } from "./reviewerCase";
import type { PrivacyReviewerCase, PrivacyReviewerCaseFailure } from "./reviewerCaseTypes";

const queueFailures = ["invalid_input", "forbidden", "storage_unavailable"] as const;
const claimFailures = [
  ...queueFailures,
  "not_found",
  "idempotency_conflict",
  "stale_version",
  "case_assigned",
  "case_not_assignable",
] as const;
type DomainFailure = (typeof claimFailures)[number];
type ReviewerFailure<Failure extends string> =
  | Failure
  | "invalid_input"
  | "csrf_rejected"
  | "fresh_auth_required"
  | "reviewer_changed"
  | "request_failed";
const queueAllowedFailures: readonly DomainFailure[] = queueFailures;
const claimAllowedFailures: readonly DomainFailure[] = claimFailures;
const sourceFailures: readonly PrivacyNativeSubjectReviewFailure[] = [
  ...queueFailures,
  "case_not_reviewable",
  "policy_unconfigured",
  "policy_stale",
  "policy_disabled",
  "unsupported_subject",
  "source_unavailable",
  "source_invalid",
  "source_limit",
];
const reviewerCaseFailures: readonly PrivacyReviewerCaseFailure[] = [
  "invalid_input",
  "forbidden",
  "evidence_unavailable",
  "storage_unavailable",
];
type ReviewerOperation<T> = (
  ...args: Parameters<typeof claimPrivacyCase>
) => Promise<Result<T, unknown>>;
type CaseTransitionOutcome = Awaited<ReturnType<typeof transitionPrivacyCase>>;
type CaseTransitionValue = Extract<CaseTransitionOutcome, { ok: true }>["value"];
type CaseTransitionFailure = Extract<CaseTransitionOutcome, { ok: false }>["error"];
const caseTransitionFailures: readonly CaseTransitionFailure[] = [
  "invalid_input",
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
];
const reviewerIdSchema = z.uuid();

async function runReviewerOperation<T, Failure extends string>(
  csrfToken: string | null,
  input: unknown,
  expectedReviewerId: unknown,
  operation: ReviewerOperation<T>,
  allowedFailures: readonly Failure[],
): Promise<Result<T, ReviewerFailure<Failure>>> {
  const signal = SIG();
  try {
    signal.throwIfAborted();
    const csrf = await guardCsrf(csrfToken);
    signal.throwIfAborted();
    if (!csrf.ok) return err("csrf_rejected");
    const expected = reviewerIdSchema.safeParse(expectedReviewerId);
    if (!expected.success) return err("invalid_input");
    const requestHeaders = await headers();
    signal.throwIfAborted();
    const current = await resolveWorkflowSession(db, requestHeaders, signal, {
      requireFresh: true,
    });
    signal.throwIfAborted();
    if (current === null) return err("fresh_auth_required");
    // The client selector can deny a stale form, but never supplies the authorized actor.
    if (expected.data !== current.user.id) return err("reviewer_changed");
    const result = await operation(
      db,
      { userId: current.user.id, sessionId: current.session.id },
      input,
      signal,
    );
    signal.throwIfAborted();
    return result.ok
      ? result
      : err(allowedFailures.find((code) => code === result.error) ?? "request_failed");
  } catch (cause) {
    signal.throwIfAborted();
    if (
      typeof cause === "object" &&
      cause !== null &&
      "name" in cause &&
      cause.name === "AbortError"
    )
      throw cause;
    return err("request_failed");
  }
}

export async function listPrivacyIntakeQueueAction(
  csrfToken: string | null,
  input: unknown,
  expectedReviewerId: unknown,
) {
  return runReviewerOperation(
    csrfToken,
    input,
    expectedReviewerId,
    listPrivacyIntakeQueue,
    queueAllowedFailures,
  );
}

export async function claimPrivacyCaseAction(
  csrfToken: string | null,
  input: unknown,
  expectedReviewerId: unknown,
) {
  return runReviewerOperation(
    csrfToken,
    input,
    expectedReviewerId,
    claimPrivacyCase,
    claimAllowedFailures,
  );
}

export async function loadPrivacyNativeSubjectReviewAction(
  csrfToken: string | null,
  input: unknown,
  expectedReviewerId: unknown,
): Promise<Result<PrivacyNativeSubjectReview, ReviewerFailure<PrivacyNativeSubjectReviewFailure>>> {
  return runReviewerOperation(
    csrfToken,
    input,
    expectedReviewerId,
    loadPrivacyNativeSubjectReview,
    sourceFailures,
  );
}

export async function readPrivacyReviewerCaseAction(
  csrfToken: string | null,
  input: unknown,
  expectedReviewerId: unknown,
): Promise<Result<PrivacyReviewerCase, ReviewerFailure<PrivacyReviewerCaseFailure>>> {
  return runReviewerOperation(
    csrfToken,
    input,
    expectedReviewerId,
    readPrivacyReviewerCase,
    reviewerCaseFailures,
  );
}

export async function transitionPrivacyCaseAction(
  csrfToken: string | null,
  input: unknown,
  expectedReviewerId: unknown,
): Promise<Result<CaseTransitionValue, ReviewerFailure<CaseTransitionFailure>>> {
  return runReviewerOperation(
    csrfToken,
    input,
    expectedReviewerId,
    transitionPrivacyCase,
    caseTransitionFailures,
  );
}
