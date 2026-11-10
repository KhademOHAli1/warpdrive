import "./__fixtures__/reviewerCaseActionsTestKit";
import assert from "node:assert/strict";
import { beforeEach, expect, expectTypeOf, test } from "vitest";
import { err } from "@/types/result";
import {
  abortReviewerCase,
  holdReviewerCasePhase,
  reviewerCaseMocks as mocks,
  PRIVATE,
  REVIEWER,
  resetReviewerCaseAction,
  reviewerCaseInput,
  reviewerCaseSignal,
} from "./__fixtures__/reviewerCaseActionsTestKit";
import type { PrivacyNativeSubjectReviewFailure } from "./nativeSubjectReviewTypes";
import {
  readPrivacyReviewerCaseAction as action,
  claimPrivacyCaseAction,
  listPrivacyIntakeQueueAction,
  loadPrivacyNativeSubjectReviewAction,
} from "./reviewerActions";
import type { PrivacyReviewerCase, PrivacyReviewerCaseFailure } from "./reviewerCaseTypes";

beforeEach(resetReviewerCaseAction);

for (const phase of ["csrf", "headers", "session", "read"] as const)
  for (const completion of ["fulfilled", "rejected"] as const)
    test(`the original abort wins after pending ${phase} ${completion}`, async () => {
      const hold = holdReviewerCasePhase(phase, completion);
      const reason = Object.freeze({ syntheticCancelled: PRIVATE, phase, completion });
      const pending = action("csrf", Object.freeze(reviewerCaseInput()), REVIEWER);
      const outcome = pending.then(
        (value) => ({ kind: "resolved" as const, value }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
      try {
        const first = await Promise.race([
          hold.entered.then(() => "entered" as const),
          outcome.then(() => "settled" as const),
        ]);
        // A denial scaffold fails this assertion immediately, without a stage-wait timeout.
        expect(first, "action must reach the selected native boundary").toBe("entered");
        assert(first === "entered");
        abortReviewerCase(reason);
        hold.release();
        const result = await outcome;
        expect(result.kind).toBe("rejected");
        assert(result.kind === "rejected");
        expect(result.error).toBe(reason);
        expect(reviewerCaseSignal().reason).toBe(reason);
        if (phase !== "read") expect(mocks.read).not.toHaveBeenCalled();
        if (phase === "csrf") expect(mocks.headers).not.toHaveBeenCalled();
        if (phase === "headers") expect(mocks.session).not.toHaveBeenCalled();
      } finally {
        hold.release();
        await outcome;
      }
    });

test("evidence_unavailable stays private to the new reader failure boundary", async () => {
  for (const operation of [
    { action: listPrivacyIntakeQueueAction, service: mocks.list },
    { action: claimPrivacyCaseAction, service: mocks.claim },
    { action: loadPrivacyNativeSubjectReviewAction, service: mocks.source },
  ]) {
    operation.service.mockResolvedValueOnce(err("evidence_unavailable"));
    expect(await operation.action("csrf", {}, REVIEWER)).toEqual(err("request_failed"));
    expect(operation.service).toHaveBeenCalledOnce();
  }
  expect(mocks.read).not.toHaveBeenCalled();
});

type Failure<Output> =
  Extract<Output, { ok: false }> extends { error: infer Error } ? Error : never;
type ActionFailures =
  | "invalid_input"
  | "csrf_rejected"
  | "fresh_auth_required"
  | "reviewer_changed"
  | "request_failed";
type ExistingReviewerFailure =
  | ActionFailures
  | "forbidden"
  | "storage_unavailable"
  | "not_found"
  | "idempotency_conflict"
  | "stale_version"
  | "case_assigned"
  | "case_not_assignable";

// Runtime completion of expectTypeOf is not compiler validation; root must run admitted TSC.
test("public success/failure types add only the intended reviewer-case contract", () => {
  type ReadOutput = Awaited<ReturnType<typeof action>>;
  expectTypeOf<
    Extract<ReadOutput, { ok: true }> extends { value: infer Value } ? Value : never
  >().toEqualTypeOf<PrivacyReviewerCase>();
  expectTypeOf<Failure<ReadOutput>>().toEqualTypeOf<ActionFailures | PrivacyReviewerCaseFailure>();
  expectTypeOf<
    Failure<Awaited<ReturnType<typeof listPrivacyIntakeQueueAction>>>
  >().toEqualTypeOf<ExistingReviewerFailure>();
  expectTypeOf<
    Failure<Awaited<ReturnType<typeof claimPrivacyCaseAction>>>
  >().toEqualTypeOf<ExistingReviewerFailure>();
  expectTypeOf<
    Failure<Awaited<ReturnType<typeof loadPrivacyNativeSubjectReviewAction>>>
  >().toEqualTypeOf<ActionFailures | PrivacyNativeSubjectReviewFailure>();
});
