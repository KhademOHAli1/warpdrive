import assert from "node:assert/strict";
import { vi } from "vitest";
import type { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import type { guardCsrf } from "@/features/identity/actions/shared";
import type { SIG } from "@/features/identity/actions/sig";
import { err, ok, type Result } from "@/types/result";
import type { claimPrivacyCase } from "../caseAssignment";
import type { listPrivacyIntakeQueue } from "../caseAssignmentQueue";
import type { transitionPrivacyCase } from "../caseCommands";
import type { loadPrivacyNativeSubjectReview } from "../nativeSubjectReview";
import type { readPrivacyReviewerCase } from "../reviewerCase";

type NativeSession = NonNullable<Awaited<ReturnType<typeof resolveWorkflowSession>>>;
type SessionBoundary = (...args: Parameters<typeof resolveWorkflowSession>) => Promise<{
  user: Pick<NativeSession["user"], "id" | "isAdmin">;
  session: Pick<NativeSession["session"], "id">;
} | null>;
type TransitionOutput = Awaited<ReturnType<typeof transitionPrivacyCase>>;
export type TransitionValue = Extract<TransitionOutput, { ok: true }>["value"];
export type NativeTransitionFailure = Extract<TransitionOutput, { ok: false }>["error"];
type TransitionBoundary = (
  ...args: Parameters<typeof transitionPrivacyCase>
) => Promise<Result<TransitionValue, unknown>>;
type DomainBoundary<Arguments extends unknown[]> = (
  ...args: Arguments
) => Promise<Result<unknown, unknown>>;

const transitionMocks = vi.hoisted(() => ({
  csrf: vi.fn<typeof guardCsrf>(),
  headers: vi.fn<() => Promise<Headers>>(),
  session: vi.fn<SessionBoundary>(),
  signal: vi.fn<typeof SIG>(),
  transition: vi.fn<TransitionBoundary>(),
  list: vi.fn<DomainBoundary<Parameters<typeof listPrivacyIntakeQueue>>>(),
  claim: vi.fn<DomainBoundary<Parameters<typeof claimPrivacyCase>>>(),
  source: vi.fn<DomainBoundary<Parameters<typeof loadPrivacyNativeSubjectReview>>>(),
  read: vi.fn<DomainBoundary<Parameters<typeof readPrivacyReviewerCase>>>(),
}));

export { transitionMocks };

vi.mock("next/headers", () => ({ headers: transitionMocks.headers }));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: transitionMocks.csrf }));
vi.mock("@/features/auth/better/sessionPolicy", () => ({
  resolveWorkflowSession: transitionMocks.session,
}));
vi.mock("@/features/identity/actions/sig", () => ({ SIG: transitionMocks.signal }));
vi.mock("../caseCommands", () => ({ transitionPrivacyCase: transitionMocks.transition }));
vi.mock("../caseAssignmentQueue", () => ({ listPrivacyIntakeQueue: transitionMocks.list }));
vi.mock("../caseAssignment", () => ({ claimPrivacyCase: transitionMocks.claim }));
vi.mock("../nativeSubjectReview", () => ({
  loadPrivacyNativeSubjectReview: transitionMocks.source,
}));
vi.mock("../reviewerCase", () => ({ readPrivacyReviewerCase: transitionMocks.read }));

// Only framework, native-session and domain orchestration boundaries are stubbed.
// Tests import the action and real lazy db directly where used; no DB I/O is mocked.
export const REVIEWER = "00000000-0000-4000-8000-000000000001";
export const SESSION = "00000000-0000-4000-8000-000000000002";
export const CASE = "00000000-0000-4000-8000-000000000003";
export const OTHER = "00000000-0000-4000-8000-000000000004";
export const OTHER_SESSION = "00000000-0000-4000-8000-000000000005";
export const COMMAND = "00000000-0000-4000-8000-000000000006";
export const PRIVATE = "PRIVATE-CASE-TRANSITION-ACTION-SENTINEL";
export const transitionInput = () => ({
  caseId: CASE,
  expectedVersion: 1,
  commandId: COMMAND,
  toStatus: "verification_needed" as const,
});
export const transitionSession = (userId = REVIEWER, sessionId = SESSION, isAdmin = false) => ({
  user: { id: userId, isAdmin },
  session: { id: sessionId },
});
export const transitionSuccess = (
  status: "verification_needed" | "refused" = "verification_needed",
): TransitionValue => ({
  id: CASE,
  kind: "access",
  status,
  version: status === "verification_needed" ? 2 : 4,
  receivedAt: new Date("2026-11-01T10:00:00.000Z"),
});
export const TRANSITION_FAILURES = [
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
] as const satisfies readonly NativeTransitionFailure[];

let controller: AbortController;
let requestHeaders: Headers;
export const transitionSignal = () => controller.signal;
export const transitionHeaders = () => requestHeaders;
export const abortTransition = (reason: unknown) => controller.abort(reason);
export function resetTransitionAction() {
  vi.resetAllMocks();
  controller = new AbortController();
  requestHeaders = new Headers({
    origin: "https://app.example.test",
    host: "app.example.test",
    "sec-fetch-site": "same-origin",
    "x-user-id": OTHER,
    cookie: `wd_sid=${PRIVATE}`,
  });
  transitionMocks.signal.mockImplementation(() => controller.signal);
  transitionMocks.csrf.mockResolvedValue(ok(true));
  transitionMocks.headers.mockResolvedValue(requestHeaders);
  transitionMocks.session.mockResolvedValue(transitionSession());
  transitionMocks.transition.mockResolvedValue(ok(transitionSuccess()));
  for (const boundary of ["list", "claim", "source", "read"] as const)
    transitionMocks[boundary].mockResolvedValue(err("forbidden"));
}

export type TransitionPhase = "csrf" | "headers" | "session" | "transition";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
export function holdTransitionPhase(phase: TransitionPhase, completion: "fulfilled" | "rejected") {
  const entered = deferred();
  const finish = deferred();
  const pause = async <Value>(value: Value): Promise<Value> => {
    entered.resolve();
    await finish.promise;
    if (completion === "rejected") assert.fail(PRIVATE);
    return value;
  };
  if (phase === "csrf") transitionMocks.csrf.mockImplementationOnce(() => pause(ok(true)));
  if (phase === "headers")
    transitionMocks.headers.mockImplementationOnce(() => pause(requestHeaders));
  if (phase === "session")
    transitionMocks.session.mockImplementationOnce(() => pause(transitionSession()));
  if (phase === "transition")
    transitionMocks.transition.mockImplementationOnce(() => pause(ok(transitionSuccess())));
  return { entered: entered.promise, release: finish.resolve };
}
