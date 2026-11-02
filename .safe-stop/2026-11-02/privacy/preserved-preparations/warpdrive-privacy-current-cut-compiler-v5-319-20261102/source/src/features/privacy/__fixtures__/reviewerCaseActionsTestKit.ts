import assert from "node:assert/strict";
import { vi } from "vitest";
import type { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import type { guardCsrf } from "@/features/identity/actions/shared";
import type { SIG } from "@/features/identity/actions/sig";
import { ok, type Result } from "@/types/result";
import type { claimPrivacyCase } from "../caseAssignment";
import type { listPrivacyIntakeQueue } from "../caseAssignmentQueue";
import type { loadPrivacyNativeSubjectReview } from "../nativeSubjectReview";
import type { readPrivacyReviewerCase } from "../reviewerCase";
import type { PrivacyReviewerCase } from "../reviewerCaseTypes";

type NativeSession = NonNullable<Awaited<ReturnType<typeof resolveWorkflowSession>>>;
type SessionBoundary = (...args: Parameters<typeof resolveWorkflowSession>) => Promise<{
  user: Pick<NativeSession["user"], "id" | "isAdmin">;
  session: Pick<NativeSession["session"], "id">;
} | null>;
type ReadBoundary = (
  ...args: Parameters<typeof readPrivacyReviewerCase>
) => Promise<Result<PrivacyReviewerCase, unknown>>;
type DomainBoundary<Arguments extends unknown[]> = (
  ...args: Arguments
) => Promise<Result<unknown, unknown>>;

const reviewerCaseMocks = vi.hoisted(() => ({
  csrf: vi.fn<typeof guardCsrf>(),
  headers: vi.fn<() => Promise<Headers>>(),
  session: vi.fn<SessionBoundary>(),
  signal: vi.fn<typeof SIG>(),
  read: vi.fn<ReadBoundary>(),
  list: vi.fn<DomainBoundary<Parameters<typeof listPrivacyIntakeQueue>>>(),
  claim: vi.fn<DomainBoundary<Parameters<typeof claimPrivacyCase>>>(),
  source: vi.fn<DomainBoundary<Parameters<typeof loadPrivacyNativeSubjectReview>>>(),
}));

export { reviewerCaseMocks };

vi.mock("next/headers", () => ({ headers: reviewerCaseMocks.headers }));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: reviewerCaseMocks.csrf }));
vi.mock("@/features/auth/better/sessionPolicy", () => ({
  resolveWorkflowSession: reviewerCaseMocks.session,
}));
vi.mock("@/features/identity/actions/sig", () => ({ SIG: reviewerCaseMocks.signal }));
vi.mock("../reviewerCase", () => ({ readPrivacyReviewerCase: reviewerCaseMocks.read }));
vi.mock("../caseAssignmentQueue", () => ({ listPrivacyIntakeQueue: reviewerCaseMocks.list }));
vi.mock("../caseAssignment", () => ({ claimPrivacyCase: reviewerCaseMocks.claim }));
vi.mock("../nativeSubjectReview", () => ({
  loadPrivacyNativeSubjectReview: reviewerCaseMocks.source,
}));

// Framework/native-session/domain orchestration only. No DB module, query or transaction is mocked.
// The session stub describes only the native fields consumed by this action, not auth internals.
export const REVIEWER = "00000000-0000-4000-8000-000000000001";
export const SESSION = "00000000-0000-4000-8000-000000000002";
export const CASE = "00000000-0000-4000-8000-000000000003";
export const OTHER = "00000000-0000-4000-8000-000000000004";
export const OTHER_SESSION = "00000000-0000-4000-8000-000000000005";
export const PRIVATE = "PRIVATE-REVIEWER-CASE-ACTION-SENTINEL";
export const reviewerCaseInput = () => ({ caseId: CASE });
export const reviewerCaseSession = (userId = REVIEWER, sessionId = SESSION, isAdmin = false) => ({
  user: { id: userId, isAdmin },
  session: { id: sessionId },
});
export const reviewerCaseSuccess = (): PrivacyReviewerCase => ({
  formatVersion: 1,
  case: {
    id: CASE,
    kind: "access",
    status: "under_review",
    version: 3,
    receivedAt: "2026-11-01T10:00:00.000Z",
    dueAt: null,
    policyVersion: 1,
  },
  request: {
    kind: "access",
    locale: "de",
    subject: { kind: "user", referenceId: OTHER },
    recipient: { channel: "email", address: "synthetic@example.test" },
    summary: "Synthetic reviewer case request",
  },
  identity: { state: "current" },
  policy: { activeVersion: 1, generation: 2 },
});

let controller: AbortController;
let requestHeaders: Headers;
export const reviewerCaseSignal = () => controller.signal;
export const reviewerCaseHeaders = () => requestHeaders;
export const abortReviewerCase = (reason: unknown) => controller.abort(reason);
export function resetReviewerCaseAction() {
  vi.resetAllMocks();
  controller = new AbortController();
  requestHeaders = new Headers({
    origin: "https://app.example.test",
    host: "app.example.test",
    "sec-fetch-site": "same-origin",
    "x-user-id": OTHER,
    cookie: `wd_sid=${PRIVATE}`,
  });
  reviewerCaseMocks.signal.mockImplementation(() => controller.signal);
  reviewerCaseMocks.csrf.mockResolvedValue(ok(true));
  reviewerCaseMocks.headers.mockResolvedValue(requestHeaders);
  reviewerCaseMocks.session.mockResolvedValue(reviewerCaseSession());
  reviewerCaseMocks.read.mockResolvedValue(ok(reviewerCaseSuccess()));
}

export type CaseActionPhase = "csrf" | "headers" | "session" | "read";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

export function holdReviewerCasePhase(
  phase: CaseActionPhase,
  completion: "fulfilled" | "rejected",
) {
  const entered = deferred();
  const finish = deferred();
  const pause = async <Value>(value: Value): Promise<Value> => {
    entered.resolve();
    await finish.promise;
    if (completion === "rejected") assert.fail(PRIVATE);
    return value;
  };
  if (phase === "csrf") reviewerCaseMocks.csrf.mockImplementationOnce(() => pause(ok(true)));
  if (phase === "headers")
    reviewerCaseMocks.headers.mockImplementationOnce(() => pause(requestHeaders));
  if (phase === "session")
    reviewerCaseMocks.session.mockImplementationOnce(() => pause(reviewerCaseSession()));
  if (phase === "read")
    reviewerCaseMocks.read.mockImplementationOnce(() => pause(ok(reviewerCaseSuccess())));
  return { entered: entered.promise, release: finish.resolve };
}
