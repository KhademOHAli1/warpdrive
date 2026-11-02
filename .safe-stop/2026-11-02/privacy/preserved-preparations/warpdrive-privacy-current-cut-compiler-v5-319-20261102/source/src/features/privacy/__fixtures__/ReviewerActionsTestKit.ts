import { expect, vi } from "vitest";
import { db } from "@/db/client";
import { err, ok } from "@/types/result";

const reviewerMocks = vi.hoisted(() => ({
  csrf: vi.fn(),
  headers: vi.fn(),
  session: vi.fn(),
  signal: vi.fn(),
  list: vi.fn(),
  claim: vi.fn(),
}));

export { reviewerMocks };

vi.mock("next/headers", () => ({ headers: reviewerMocks.headers }));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: reviewerMocks.csrf }));
vi.mock("@/features/auth/better/sessionPolicy", () => ({
  resolveWorkflowSession: reviewerMocks.session,
}));
vi.mock("@/features/identity/actions/sig", () => ({ SIG: reviewerMocks.signal }));
vi.mock("../caseAssignmentQueue", () => ({ listPrivacyIntakeQueue: reviewerMocks.list }));
vi.mock("../caseAssignment", () => ({ claimPrivacyCase: reviewerMocks.claim }));

import { claimPrivacyCaseAction, listPrivacyIntakeQueueAction } from "../reviewerActions";

// Native boundary isolation only. The real lazy DB handle is forwarded unchanged;
// no query, transaction, database result or database authorization is simulated.
export { db, err, ok };
export const REVIEWER_ID = "00000000-0000-4000-8000-000000000001";
export const SESSION_ID = "00000000-0000-4000-8000-000000000002";
export const CASE_ID = "00000000-0000-4000-8000-000000000003";
export const COMMAND_ID = "00000000-0000-4000-8000-000000000004";
export const OTHER_ID = "00000000-0000-4000-8000-000000000005";
export const OTHER_SESSION_ID = "00000000-0000-4000-8000-000000000006";
export const PRIVATE = "PRIVATE-REVIEWER-ACTION-SENTINEL";
const receivedAt = new Date("2026-11-01T10:00:00.000Z");

export const reviewerSubjects = [
  {
    name: "list",
    action: listPrivacyIntakeQueueAction,
    service: reviewerMocks.list,
    input: () => ({ limit: 25, afterId: "00000000-0000-4000-8000-000000000000" }),
    success: () => ({
      items: [
        { id: CASE_ID, kind: "access", status: "received", version: 7, receivedAt, dueAt: null },
      ],
      nextAfterId: null,
      snapshot: "live_unassigned",
    }),
  },
  {
    name: "claim",
    action: claimPrivacyCaseAction,
    service: reviewerMocks.claim,
    input: () => ({ caseId: CASE_ID, expectedVersion: 7, commandId: COMMAND_ID }),
    success: () => ({ id: CASE_ID, version: 8, status: "received" }),
  },
] as const;

let requestAbort: AbortController;
let requestHeaders: Headers;
export const reviewerSignal = () => requestAbort.signal;
export const reviewerHeaders = () => requestHeaders;
export const abortReviewerRequest = (reason: unknown) => requestAbort.abort(reason);
export const reviewerSession = (userId = REVIEWER_ID, sessionId = SESSION_ID, isAdmin = false) => ({
  user: { id: userId, isAdmin },
  session: { id: sessionId },
});

export function resetReviewerBoundary() {
  vi.resetAllMocks();
  requestAbort = new AbortController();
  requestHeaders = new Headers({
    origin: "https://app.example.test",
    host: "app.example.test",
    "sec-fetch-site": "same-origin",
    "x-user-id": OTHER_ID,
    cookie: `wd_sid=${PRIVATE}`,
  });
  reviewerMocks.signal.mockImplementation(() => requestAbort.signal);
  reviewerMocks.headers.mockResolvedValue(requestHeaders);
  reviewerMocks.csrf.mockResolvedValue(ok(true));
  reviewerMocks.session.mockResolvedValue(reviewerSession());
  for (const subject of reviewerSubjects) subject.service.mockResolvedValue(ok(subject.success()));
}

export function expectNoReviewerService() {
  for (const subject of reviewerSubjects) expect(subject.service).not.toHaveBeenCalled();
}
