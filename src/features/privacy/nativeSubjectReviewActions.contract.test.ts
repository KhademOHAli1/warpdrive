import { beforeEach, expect, expectTypeOf, test } from "vitest";
import { err } from "@/types/result";
import {
  actionMocks as mocks,
  REVIEWER,
  resetNativeReviewAction,
} from "./nativeSubjectReviewActionsTestKit";
import type { PrivacyNativeSubjectReviewFailure } from "./nativeSubjectReviewTypes";
import {
  claimPrivacyCaseAction,
  listPrivacyIntakeQueueAction,
  type loadPrivacyNativeSubjectReviewAction,
} from "./reviewerActions";

beforeEach(resetNativeReviewAction);
const sourceOnlyFailures = [
  "case_not_reviewable",
  "policy_unconfigured",
  "policy_stale",
  "policy_disabled",
  "unsupported_subject",
  "source_unavailable",
  "source_invalid",
  "source_limit",
] as const;

for (const operation of [
  { name: "list", action: listPrivacyIntakeQueueAction, service: mocks.list },
  { name: "claim", action: claimPrivacyCaseAction, service: mocks.claim },
])
  test.each(sourceOnlyFailures)(
    `${operation.name} does not admit source-only failure %s`,
    async (failure) => {
      operation.service.mockResolvedValueOnce(err(failure));
      expect(await operation.action("csrf", {}, REVIEWER)).toEqual(err("request_failed"));
      expect(operation.service).toHaveBeenCalledTimes(1);
      expect(mocks.load).not.toHaveBeenCalled();
    },
  );

type Failure<Result> =
  Extract<Result, { ok: false }> extends { error: infer Error } ? Error : never;
type ExistingReviewerFailure =
  | "invalid_input"
  | "forbidden"
  | "storage_unavailable"
  | "not_found"
  | "idempotency_conflict"
  | "stale_version"
  | "case_assigned"
  | "case_not_assignable"
  | "csrf_rejected"
  | "fresh_auth_required"
  | "reviewer_changed"
  | "request_failed";
type SourceActionFailure =
  | PrivacyNativeSubjectReviewFailure
  | "csrf_rejected"
  | "fresh_auth_required"
  | "reviewer_changed"
  | "request_failed";

test("list public failure union preserves its existing contract without source-only codes", () => {
  expectTypeOf<
    Failure<Awaited<ReturnType<typeof listPrivacyIntakeQueueAction>>>
  >().toEqualTypeOf<ExistingReviewerFailure>();
});
test("claim public failure union preserves its existing contract without source-only codes", () => {
  expectTypeOf<
    Failure<Awaited<ReturnType<typeof claimPrivacyCaseAction>>>
  >().toEqualTypeOf<ExistingReviewerFailure>();
});
test("source action public failures exclude unrelated queue/claim codes", () => {
  expectTypeOf<
    Failure<Awaited<ReturnType<typeof loadPrivacyNativeSubjectReviewAction>>>
  >().toEqualTypeOf<SourceActionFailure>();
});
