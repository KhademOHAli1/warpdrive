import { vi } from "vitest";
import { ok } from "@/types/result";
import type { PrivacyNativeSubjectReview } from "./nativeSubjectReviewTypes";

const actionMocks = vi.hoisted(() => ({
  csrf: vi.fn(),
  headers: vi.fn(),
  session: vi.fn(),
  signal: vi.fn(),
  load: vi.fn(),
  list: vi.fn(),
  claim: vi.fn(),
}));

export { actionMocks };

vi.mock("next/headers", () => ({ headers: actionMocks.headers }));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: actionMocks.csrf }));
vi.mock("@/features/auth/better/sessionPolicy", () => ({
  resolveWorkflowSession: actionMocks.session,
}));
vi.mock("@/features/identity/actions/sig", () => ({ SIG: actionMocks.signal }));
vi.mock("./nativeSubjectReview", () => ({ loadPrivacyNativeSubjectReview: actionMocks.load }));
vi.mock("./caseAssignmentQueue", () => ({ listPrivacyIntakeQueue: actionMocks.list }));
vi.mock("./caseAssignment", () => ({ claimPrivacyCase: actionMocks.claim }));

// Framework/native-session/service boundary stubs only. The lazy real DB handle is forwarded;
// no query, transaction, database result or database authorization chain is mocked.
export const REVIEWER = "00000000-0000-4000-8000-000000000001";
export const SESSION = "00000000-0000-4000-8000-000000000002";
export const CASE = "00000000-0000-4000-8000-000000000003";
export const SUBJECT = "00000000-0000-4000-8000-000000000004";
export const OTHER = "00000000-0000-4000-8000-000000000005";
export const OTHER_SESSION = "00000000-0000-4000-8000-000000000006";
export const PRIVATE = "PRIVATE-NATIVE-SUBJECT-ACTION-SENTINEL";
export const actionInput = () => ({ caseId: CASE });
export const actionSession = (userId = REVIEWER, sessionId = SESSION, isAdmin = false) => ({
  user: { id: userId, isAdmin },
  session: { id: sessionId },
});
export const actionSuccess = (): PrivacyNativeSubjectReview => ({
  formatVersion: 1,
  state: "preliminary",
  complete: false,
  reviewRequired: true,
  binding: {
    caseId: CASE,
    caseVersion: 2,
    subject: { kind: "user", referenceId: SUBJECT },
    identityScopeVersion: 1,
    recipientVersion: 1,
    verificationVersion: 2,
    policyVersion: 1,
    policyGeneration: 1,
  },
  record: {
    store: "users",
    recordType: "user",
    adapterVersion: 1,
    recordId: SUBJECT,
    sourceFingerprint: "a".repeat(64),
    values: {
      id: SUBJECT,
      name: "Synthetic subject",
      email: "synthetic@example.test",
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:00:00.000Z",
    },
  },
  coverage: [
    { store: "users", status: "incomplete", code: "direct_subject_only" },
    { store: "auth_accounts", status: "unsupported", code: "adapter_unavailable" },
  ],
});
let controller: AbortController;
let requestHeaders: Headers;
export const actionSignal = () => controller.signal;
export const actionHeaders = () => requestHeaders;
export const abortAction = (reason: unknown) => controller.abort(reason);
export function resetNativeReviewAction() {
  vi.resetAllMocks();
  controller = new AbortController();
  requestHeaders = new Headers({
    origin: "https://app.example.test",
    host: "app.example.test",
    "sec-fetch-site": "same-origin",
    "x-user-id": OTHER,
    cookie: `wd_sid=${PRIVATE}`,
  });
  actionMocks.signal.mockImplementation(() => controller.signal);
  actionMocks.csrf.mockResolvedValue(ok(true));
  actionMocks.headers.mockResolvedValue(requestHeaders);
  actionMocks.session.mockResolvedValue(actionSession());
  actionMocks.load.mockResolvedValue(ok(actionSuccess()));
}
export function fulfilledPhase(phase: "csrf" | "headers" | "session" | "load"): unknown {
  if (phase === "csrf") return ok(true);
  if (phase === "headers") return requestHeaders;
  if (phase === "session") return actionSession();
  return ok(actionSuccess());
}
export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
