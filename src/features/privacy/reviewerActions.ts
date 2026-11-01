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
type ReviewerFailure =
  | DomainFailure
  | "csrf_rejected"
  | "fresh_auth_required"
  | "reviewer_changed"
  | "request_failed";
type ReviewerOperation<T> = (
  ...args: Parameters<typeof claimPrivacyCase>
) => Promise<Result<T, unknown>>;
const reviewerIdSchema = z.uuid();

async function runReviewerOperation<T>(
  csrfToken: string | null,
  input: unknown,
  expectedReviewerId: unknown,
  operation: ReviewerOperation<T>,
  allowedFailures: readonly DomainFailure[],
): Promise<Result<T, ReviewerFailure>> {
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
    queueFailures,
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
    claimFailures,
  );
}
