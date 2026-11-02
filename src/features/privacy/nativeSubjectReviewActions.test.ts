import { beforeEach, expect, test } from "vitest";
import { db } from "@/db/client";
import { err, ok } from "@/types/result";
import {
  actionHeaders,
  actionInput,
  actionSession,
  actionSignal,
  actionSuccess,
  CASE,
  actionMocks as mocks,
  OTHER,
  OTHER_SESSION,
  PRIVATE,
  REVIEWER,
  resetNativeReviewAction,
  SESSION,
} from "./nativeSubjectReviewActionsTestKit";
import { loadPrivacyNativeSubjectReviewAction as action } from "./reviewerActions";

beforeEach(resetNativeReviewAction);

test("forwards only native db/actor/session/bounded action signal and the unchanged domain selector", async () => {
  const input = Object.freeze(actionInput());
  const serviceResult = ok(actionSuccess());
  mocks.load.mockResolvedValueOnce(serviceResult);
  const result = await action("csrf", input, REVIEWER);
  expect(result).toBe(serviceResult);
  expect(mocks.signal).toHaveBeenCalledTimes(1);
  expect(mocks.signal).toHaveBeenCalledWith();
  expect(mocks.csrf).toHaveBeenCalledTimes(1);
  expect(mocks.csrf).toHaveBeenCalledWith("csrf");
  expect(mocks.headers).toHaveBeenCalledTimes(1);
  expect(mocks.session).toHaveBeenCalledTimes(1);
  expect(mocks.session).toHaveBeenCalledWith(db, actionHeaders(), actionSignal(), {
    requireFresh: true,
  });
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(mocks.load).toHaveBeenCalledWith(
    db,
    { userId: REVIEWER, sessionId: SESSION },
    input,
    actionSignal(),
  );
  expect(mocks.load.mock.calls[0]?.[0]).toBe(db);
  expect(mocks.load.mock.calls[0]?.[2]).toBe(input);
  expect(mocks.load.mock.calls[0]?.[3]).toBe(actionSignal());
  expect(actionSignal()).toBeInstanceOf(AbortSignal);
  expect(mocks.csrf.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.headers.mock.invocationCallOrder[0] ?? 0,
  );
  expect(mocks.headers.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.session.mock.invocationCallOrder[0] ?? 0,
  );
  expect(mocks.session.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.load.mock.invocationCallOrder[0] ?? 0,
  );
  expect(input).toEqual({ caseId: CASE });
  expect(structuredClone(result)).toEqual(result);
  expect(JSON.stringify(result)).not.toMatch(
    /PRIVATE-|approvalId|scopeApproved|exportToken|metadataEnc/,
  );
  expect(JSON.stringify(result)).not.toContain(REVIEWER);
  expect(JSON.stringify(result)).not.toContain(SESSION);
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.claim).not.toHaveBeenCalled();
});

test("administrator status never replaces the native domain capability decision", async () => {
  mocks.session.mockResolvedValueOnce(actionSession(REVIEWER, SESSION, true));
  mocks.load.mockResolvedValueOnce(err("forbidden"));
  expect(await action("csrf", actionInput(), REVIEWER)).toEqual(err("forbidden"));
  expect(mocks.load).toHaveBeenCalledTimes(1);
});

test.each([null, "wrong-token", "csrf"])(
  "CSRF rejection precedes headers/session/service for %j",
  async (token) => {
    mocks.csrf.mockResolvedValueOnce(err({ secret: PRIVATE }));
    const result = await action(token, actionInput(), REVIEWER);
    expect(result).toEqual(err("csrf_rejected"));
    expect(mocks.csrf).toHaveBeenCalledWith(token);
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
  },
);

test.each(["signed out", "expired fresh proof", "pending MFA", "pending enrollment"])(
  "native resolver denial for %s cannot reach subject fields",
  async () => {
    // Resolver boundary result only; this does not simulate or qualify its internal auth queries.
    mocks.session.mockResolvedValueOnce(null);
    expect(await action("csrf", actionInput(), REVIEWER)).toEqual(err("fresh_auth_required"));
    expect(mocks.session).toHaveBeenCalledWith(db, actionHeaders(), actionSignal(), {
      requireFresh: true,
    });
    expect(mocks.load).not.toHaveBeenCalled();
  },
);

test.each([undefined, null, "", 42, {}, "not-a-uuid", ` ${REVIEWER} `])(
  "malformed deny-only reviewer selector %j cannot identify the actor",
  async (expected) => {
    expect(await action("csrf", actionInput(), expected)).toEqual(err("invalid_input"));
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  },
);

test("a different expected reviewer denies instead of choosing that actor", async () => {
  expect(await action("csrf", actionInput(), OTHER)).toEqual(err("reviewer_changed"));
  expect(mocks.session).toHaveBeenCalledTimes(1);
  expect(mocks.load).not.toHaveBeenCalled();
});

test("CSRF denial still precedes a malformed reviewer selector", async () => {
  mocks.csrf.mockResolvedValueOnce(err(PRIVATE));
  expect(await action(null, actionInput(), { userId: OTHER })).toEqual(err("csrf_rejected"));
  expect(mocks.headers).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.load).not.toHaveBeenCalled();
});

test.each([
  { actor: { userId: OTHER, sessionId: OTHER_SESSION } },
  { userId: OTHER },
  { sessionId: OTHER_SESSION, isAdmin: true },
  { db: { secret: PRIVATE } },
  { signal: { aborted: false } },
  { subject: { kind: "user", referenceId: OTHER } },
  { subjectId: OTHER },
  { sourceFingerprint: "b".repeat(64) },
  { scopeApproved: true, approvalId: OTHER },
  { coverage: [], complete: true },
])(
  "client metadata %j remains raw domain input and cannot replace native context",
  async (extra) => {
    const input = Object.freeze({ ...actionInput(), ...extra });
    const before = structuredClone(input);
    mocks.load.mockResolvedValueOnce(err("invalid_input"));
    expect(await action("csrf", input, REVIEWER)).toEqual(err("invalid_input"));
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.load).toHaveBeenCalledWith(
      db,
      { userId: REVIEWER, sessionId: SESSION },
      input,
      actionSignal(),
    );
    expect(mocks.load.mock.calls[0]?.[0]).toBe(db);
    expect(mocks.load.mock.calls[0]?.[2]).toBe(input);
    expect(mocks.load.mock.calls[0]?.[3]).toBe(actionSignal());
    expect(input).toEqual(before);
  },
);

test.each([null, undefined, {}, "opaque-reference", { caseId: "invalid" }, { caseId: [CASE] }])(
  "malformed domain selector %j is forwarded only after native context and maps invalid_input",
  async (input) => {
    mocks.load.mockResolvedValueOnce(err("invalid_input"));
    expect(await action("csrf", input, REVIEWER)).toEqual(err("invalid_input"));
    expect(mocks.load).toHaveBeenCalledWith(
      db,
      { userId: REVIEWER, sessionId: SESSION },
      input,
      actionSignal(),
    );
    expect(mocks.load.mock.calls[0]?.[2]).toBe(input);
  },
);

test.each([
  "invalid_input",
  "forbidden",
  "case_not_reviewable",
  "policy_unconfigured",
  "policy_stale",
  "policy_disabled",
  "unsupported_subject",
  "source_unavailable",
  "source_invalid",
  "source_limit",
  "storage_unavailable",
] as const)("preserves only this operation's typed domain failure %s", async (failure) => {
  mocks.load.mockResolvedValueOnce(err(failure));
  expect(await action("csrf", actionInput(), REVIEWER)).toEqual(err(failure));
});

test.each([
  PRIVATE,
  { secret: PRIVATE },
  new Error(PRIVATE),
  "stale_version",
  "case_assigned",
  "not_found",
  "idempotency_conflict",
  "case_not_assignable",
  "fresh_auth_required",
  "csrf_rejected",
  "reviewer_changed",
])("unknown or another operation's domain failure %j stays request_failed", async (failure) => {
  mocks.load.mockResolvedValueOnce(err(failure));
  const result = await action("csrf", actionInput(), REVIEWER);
  expect(result).toEqual(err("request_failed"));
  expect(JSON.stringify(result)).not.toContain(PRIVATE);
});

test.each(["csrf", "headers", "session", "load"] as const)(
  "minimizes a thrown %s exception without private driver or session details",
  async (phase) => {
    mocks[phase].mockRejectedValueOnce(new Error(PRIVATE));
    const result = await action("csrf", actionInput(), REVIEWER);
    expect(result).toEqual(err("request_failed"));
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
    if (phase !== "load") expect(mocks.load).not.toHaveBeenCalled();
  },
);

test.each(["csrf", "headers", "session", "load"] as const)(
  "preserves the original thrown %s AbortError even before the action signal aborts",
  async (phase) => {
    const reason = new DOMException("Synthetic native subject action cancellation", "AbortError");
    mocks[phase].mockRejectedValueOnce(reason);
    await expect(action("csrf", actionInput(), REVIEWER)).rejects.toBe(reason);
    if (phase !== "load") expect(mocks.load).not.toHaveBeenCalled();
  },
);

test("each request re-resolves native identity and a previous selector cannot authorize an account swap", async () => {
  expect(await action("csrf", actionInput(), REVIEWER)).toEqual(ok(actionSuccess()));
  mocks.session.mockResolvedValueOnce(actionSession(OTHER, OTHER_SESSION));
  expect(await action("csrf", actionInput(), REVIEWER)).toEqual(err("reviewer_changed"));
  expect(mocks.session).toHaveBeenCalledTimes(2);
  expect(mocks.load).toHaveBeenCalledTimes(1);
});
