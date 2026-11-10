import "./__fixtures__/reviewerCaseActionsTestKit";
import { beforeEach, expect, test } from "vitest";
import { db } from "@/db/client";
import { err, ok } from "@/types/result";
import {
  abortReviewerCase,
  CASE,
  reviewerCaseMocks as mocks,
  OTHER,
  OTHER_SESSION,
  PRIVATE,
  REVIEWER,
  resetReviewerCaseAction,
  reviewerCaseHeaders,
  reviewerCaseInput,
  reviewerCaseSession,
  reviewerCaseSignal,
  reviewerCaseSuccess,
  SESSION,
} from "./__fixtures__/reviewerCaseActionsTestKit";
import { readPrivacyReviewerCaseAction as action } from "./reviewerActions";

beforeEach(resetReviewerCaseAction);

test("returns the exact reader result and forwards only the lazy real db/native actor/signal/raw selector", async () => {
  const input = Object.freeze(reviewerCaseInput());
  const original = structuredClone(input);
  const serviceResult = ok(reviewerCaseSuccess());
  mocks.session.mockResolvedValueOnce(reviewerCaseSession(REVIEWER, OTHER_SESSION));
  mocks.read.mockResolvedValueOnce(serviceResult);
  expect(await action("csrf", input, REVIEWER)).toBe(serviceResult);
  expect(mocks.signal).toHaveBeenCalledTimes(1);
  expect(mocks.signal).toHaveBeenCalledWith();
  expect(mocks.csrf).toHaveBeenCalledTimes(1);
  expect(mocks.csrf).toHaveBeenCalledWith("csrf");
  expect(mocks.headers).toHaveBeenCalledTimes(1);
  expect(mocks.headers).toHaveBeenCalledWith();
  expect(mocks.session).toHaveBeenCalledTimes(1);
  expect(mocks.session).toHaveBeenCalledWith(db, reviewerCaseHeaders(), reviewerCaseSignal(), {
    requireFresh: true,
  });
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.read).toHaveBeenCalledWith(
    db,
    { userId: REVIEWER, sessionId: OTHER_SESSION },
    input,
    reviewerCaseSignal(),
  );
  expect(mocks.read.mock.calls[0]?.[0]).toBe(db);
  expect(mocks.read.mock.calls[0]?.[2]).toBe(input);
  expect(mocks.read.mock.calls[0]?.[3]).toBe(reviewerCaseSignal());
  expect(mocks.csrf.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.headers.mock.invocationCallOrder[0] ?? 0,
  );
  expect(mocks.headers.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.session.mock.invocationCallOrder[0] ?? 0,
  );
  expect(mocks.session.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.read.mock.invocationCallOrder[0] ?? 0,
  );
  expect(input).toEqual(original);
  expect(structuredClone(serviceResult)).toEqual(serviceResult);
  expect(JSON.stringify(serviceResult)).not.toMatch(
    /PRIVATE-|metadataEnc|subjectEnc|recipientEnc|intakeKey|scopeApproved/,
  );
  expect(JSON.stringify(serviceResult)).not.toContain(REVIEWER);
  expect(JSON.stringify(serviceResult)).not.toContain(SESSION);
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.source).not.toHaveBeenCalled();
});

test("administrator status leaves current case capability denial to the native reader", async () => {
  mocks.session.mockResolvedValueOnce(reviewerCaseSession(REVIEWER, SESSION, true));
  mocks.read.mockResolvedValueOnce(err("forbidden"));
  expect(await action("csrf", reviewerCaseInput(), REVIEWER)).toEqual(err("forbidden"));
  expect(mocks.read).toHaveBeenCalledOnce();
});

test("CSRF denial precedes a malformed reviewer selector and native context", async () => {
  mocks.csrf.mockResolvedValueOnce(err(PRIVATE));
  const result = await action(null, reviewerCaseInput(), { userId: OTHER });
  expect(result).toEqual(err("csrf_rejected"));
  expect(mocks.csrf).toHaveBeenCalledWith(null);
  expect(mocks.headers).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain(PRIVATE);
});

test("native fresh-session denial cannot reach the case reader", async () => {
  mocks.session.mockResolvedValueOnce(null);
  expect(await action("csrf", reviewerCaseInput(), REVIEWER)).toEqual(err("fresh_auth_required"));
  expect(mocks.session).toHaveBeenCalledWith(db, reviewerCaseHeaders(), reviewerCaseSignal(), {
    requireFresh: true,
  });
  expect(mocks.read).not.toHaveBeenCalled();
});

test.each([undefined, "not-a-reviewer-uuid"])(
  "malformed reviewer selector %j denies before native lookup",
  async (expected) => {
    expect(await action("csrf", reviewerCaseInput(), expected)).toEqual(err("invalid_input"));
    expect(mocks.csrf).toHaveBeenCalledOnce();
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  },
);

test("a different expected reviewer is a denial fence and cannot choose the actor", async () => {
  expect(await action("csrf", reviewerCaseInput(), OTHER)).toEqual(err("reviewer_changed"));
  expect(mocks.session).toHaveBeenCalledOnce();
  expect(mocks.read).not.toHaveBeenCalled();
});

test("forged actor/approval fields remain unchanged raw input for strict native-domain rejection", async () => {
  const input = Object.freeze({
    caseId: CASE,
    actor: Object.freeze({ userId: OTHER, sessionId: OTHER_SESSION }),
    approvalId: OTHER,
    scopeApproved: true,
    isAdmin: true,
  });
  const before = structuredClone(input);
  mocks.read.mockResolvedValueOnce(err("invalid_input"));
  expect(await action("csrf", input, REVIEWER)).toEqual(err("invalid_input"));
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.read).toHaveBeenCalledWith(
    db,
    { userId: REVIEWER, sessionId: SESSION },
    input,
    reviewerCaseSignal(),
  );
  expect(mocks.read.mock.calls[0]?.[2]).toBe(input);
  expect(input).toEqual(before);
});

test.each(["invalid_input", "forbidden", "evidence_unavailable", "storage_unavailable"] as const)(
  "preserves the reviewer-case domain failure %s",
  async (failure) => {
    mocks.read.mockResolvedValueOnce(err(failure));
    expect(await action("csrf", reviewerCaseInput(), REVIEWER)).toEqual(err(failure));
    expect(mocks.read).toHaveBeenCalledOnce();
  },
);

test.each([PRIVATE, { driverPayload: PRIVATE }])(
  "unknown reader failure %j remains static request_failed",
  async (failure) => {
    mocks.read.mockResolvedValueOnce(err(failure));
    const result = await action("csrf", reviewerCaseInput(), REVIEWER);
    expect(result).toEqual(err("request_failed"));
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
  },
);

test.each(["csrf", "headers", "session", "read"] as const)(
  "minimizes a sensitive thrown %s failure",
  async (phase) => {
    mocks[phase].mockRejectedValueOnce(new Error(PRIVATE));
    const result = await action("csrf", reviewerCaseInput(), REVIEWER);
    expect(result).toEqual(err("request_failed"));
    expect(mocks[phase]).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
    if (phase !== "read") expect(mocks.read).not.toHaveBeenCalled();
  },
);

test("a reader AbortError is preserved even before the shared action signal aborts", async () => {
  const reason = new DOMException("Synthetic reviewer case cancellation", "AbortError");
  mocks.read.mockRejectedValueOnce(reason);
  await expect(action("csrf", reviewerCaseInput(), REVIEWER)).rejects.toBe(reason);
});

test("pre-abort preserves the exact arbitrary reason before boundary I/O", async () => {
  const reason = Object.freeze({ syntheticCancelled: PRIVATE });
  abortReviewerCase(reason);
  await expect(action("csrf", reviewerCaseInput(), REVIEWER)).rejects.toBe(reason);
  expect(mocks.signal).toHaveBeenCalledTimes(1);
  expect(mocks.signal).toHaveBeenCalledWith();
  expect(mocks.csrf).not.toHaveBeenCalled();
  expect(mocks.headers).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
