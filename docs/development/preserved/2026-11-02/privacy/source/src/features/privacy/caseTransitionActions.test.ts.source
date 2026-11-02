import "./__fixtures__/CaseTransitionActionsTestKit";
import { beforeEach, expect, test } from "vitest";
import { db } from "@/db/client";
import { err, ok } from "@/types/result";
import {
  abortTransition,
  transitionMocks as mocks,
  OTHER,
  OTHER_SESSION,
  PRIVATE,
  REVIEWER,
  resetTransitionAction,
  SESSION,
  TRANSITION_FAILURES,
  transitionHeaders,
  transitionInput,
  transitionSession,
  transitionSignal,
  transitionSuccess,
} from "./__fixtures__/CaseTransitionActionsTestKit";
import { transitionPrivacyCaseAction as action } from "./reviewerActions";

beforeEach(resetTransitionAction);

test("the first received-to-verification command forwards exact native context and returns the exact result", async () => {
  const input = Object.freeze(transitionInput());
  const original = structuredClone(input);
  const serviceResult = ok(transitionSuccess());
  mocks.session.mockResolvedValueOnce(transitionSession(REVIEWER, OTHER_SESSION));
  mocks.transition.mockResolvedValueOnce(serviceResult);
  expect(await action("csrf", input, REVIEWER)).toBe(serviceResult);
  expect(mocks.signal).toHaveBeenCalledTimes(1);
  expect(mocks.signal).toHaveBeenCalledWith();
  expect(mocks.csrf).toHaveBeenCalledTimes(1);
  expect(mocks.csrf).toHaveBeenCalledWith("csrf");
  expect(mocks.headers).toHaveBeenCalledTimes(1);
  expect(mocks.headers).toHaveBeenCalledWith();
  expect(mocks.session).toHaveBeenCalledTimes(1);
  expect(mocks.session).toHaveBeenCalledWith(db, transitionHeaders(), transitionSignal(), {
    requireFresh: true,
  });
  expect(mocks.transition).toHaveBeenCalledTimes(1);
  expect(mocks.transition).toHaveBeenCalledWith(
    db,
    { userId: REVIEWER, sessionId: OTHER_SESSION },
    input,
    transitionSignal(),
  );
  expect(mocks.transition.mock.calls[0]?.[0]).toBe(db);
  expect(mocks.transition.mock.calls[0]?.[2]).toBe(input);
  expect(mocks.transition.mock.calls[0]?.[3]).toBe(transitionSignal());
  expect(mocks.csrf.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.headers.mock.invocationCallOrder[0] ?? 0,
  );
  expect(mocks.headers.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.session.mock.invocationCallOrder[0] ?? 0,
  );
  expect(mocks.session.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.transition.mock.invocationCallOrder[0] ?? 0,
  );
  expect(input).toEqual(original);
  expect(JSON.stringify(serviceResult)).not.toContain(REVIEWER);
  expect(JSON.stringify(serviceResult)).not.toContain(SESSION);
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.source).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});

test("an optional reason and every frozen strict-domain command field are forwarded without rewriting", async () => {
  const input = Object.freeze({
    ...transitionInput(),
    expectedVersion: 3,
    toStatus: "refused" as const,
    reason: `  ${PRIVATE}  `,
  });
  const before = structuredClone(input);
  const serviceResult = ok(transitionSuccess("refused"));
  mocks.transition.mockResolvedValueOnce(serviceResult);
  expect(await action("csrf", input, REVIEWER)).toBe(serviceResult);
  expect(mocks.transition).toHaveBeenCalledTimes(1);
  expect(mocks.transition.mock.calls[0]?.[2]).toBe(input);
  expect(input).toEqual(before);
  expect(JSON.stringify(serviceResult)).not.toContain(PRIVATE);
});

test("administrator status does not bypass the domain's current case authority denial", async () => {
  mocks.session.mockResolvedValueOnce(transitionSession(REVIEWER, SESSION, true));
  mocks.transition.mockResolvedValueOnce(err("forbidden"));
  expect(await action("csrf", transitionInput(), REVIEWER)).toEqual(err("forbidden"));
  expect(mocks.transition).toHaveBeenCalledTimes(1);
});

test("CSRF denial precedes malformed reviewer selection and all native context", async () => {
  mocks.csrf.mockResolvedValueOnce(err(PRIVATE));
  const result = await action(null, transitionInput(), { userId: OTHER });
  expect(mocks.csrf).toHaveBeenCalledTimes(1);
  expect(mocks.csrf).toHaveBeenCalledWith(null);
  expect(result).toEqual(err("csrf_rejected"));
  expect(mocks.headers).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.transition).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain(PRIVATE);
});

test("a denied native fresh session cannot reach the transition phase", async () => {
  mocks.session.mockResolvedValueOnce(null);
  expect(await action("csrf", transitionInput(), REVIEWER)).toEqual(err("fresh_auth_required"));
  expect(mocks.session).toHaveBeenCalledWith(db, transitionHeaders(), transitionSignal(), {
    requireFresh: true,
  });
  expect(mocks.transition).not.toHaveBeenCalled();
});

test.each([undefined, "not-a-reviewer-uuid"])(
  "malformed client reviewer selector %j denies after CSRF and before native lookup",
  async (expected) => {
    expect(await action("csrf", transitionInput(), expected)).toEqual(err("invalid_input"));
    expect(mocks.csrf).toHaveBeenCalledTimes(1);
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.transition).not.toHaveBeenCalled();
  },
);

test("a different client reviewer selector denies and never becomes the transition actor", async () => {
  expect(await action("csrf", transitionInput(), OTHER)).toEqual(err("reviewer_changed"));
  expect(mocks.session).toHaveBeenCalledTimes(1);
  expect(mocks.transition).not.toHaveBeenCalled();
});

test("forged actor and approval fields remain raw input for strict native-domain rejection", async () => {
  const input = Object.freeze({
    ...transitionInput(),
    actor: Object.freeze({ userId: OTHER, sessionId: OTHER_SESSION }),
    approvalId: OTHER,
    scopeApproved: true,
    isAdmin: true,
  });
  const before = structuredClone(input);
  mocks.transition.mockResolvedValueOnce(err("invalid_input"));
  expect(await action("csrf", input, REVIEWER)).toEqual(err("invalid_input"));
  expect(mocks.transition).toHaveBeenCalledTimes(1);
  expect(mocks.transition).toHaveBeenCalledWith(
    db,
    { userId: REVIEWER, sessionId: SESSION },
    input,
    transitionSignal(),
  );
  expect(mocks.transition.mock.calls[0]?.[2]).toBe(input);
  expect(input).toEqual(before);
});

test.each(TRANSITION_FAILURES)("preserves native static transition failure %s", async (failure) => {
  mocks.transition.mockResolvedValueOnce(err(failure));
  const result = await action("csrf", transitionInput(), REVIEWER);
  expect(mocks.transition).toHaveBeenCalledTimes(1);
  expect(result).toEqual(err(failure));
});

test.each([PRIVATE, { driverPayload: PRIVATE }])(
  "an unknown domain error %j becomes only static request_failed after the phase runs",
  async (failure) => {
    mocks.transition.mockResolvedValueOnce(err(failure));
    const result = await action("csrf", transitionInput(), REVIEWER);
    expect(mocks.transition).toHaveBeenCalledTimes(1);
    expect(result).toEqual(err("request_failed"));
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
  },
);

test.each(["csrf", "headers", "session", "transition"] as const)(
  "a sensitive thrown %s failure is minimized only after that phase runs",
  async (phase) => {
    mocks[phase].mockRejectedValueOnce(new Error(PRIVATE));
    const result = await action("csrf", transitionInput(), REVIEWER);
    expect(mocks[phase]).toHaveBeenCalledTimes(1);
    expect(result).toEqual(err("request_failed"));
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
    if (phase !== "transition") expect(mocks.transition).not.toHaveBeenCalled();
  },
);

test("a native transition AbortError is preserved even before the action signal aborts", async () => {
  const reason = new DOMException("Synthetic case transition cancellation", "AbortError");
  mocks.transition.mockRejectedValueOnce(reason);
  await expect(action("csrf", transitionInput(), REVIEWER)).rejects.toBe(reason);
  expect(mocks.transition).toHaveBeenCalledTimes(1);
});

test("pre-abort preserves the exact arbitrary reason before boundary I/O", async () => {
  const reason = Object.freeze({ syntheticCancelled: PRIVATE });
  abortTransition(reason);
  await expect(action("csrf", transitionInput(), REVIEWER)).rejects.toBe(reason);
  expect(mocks.signal).toHaveBeenCalledTimes(1);
  expect(mocks.signal).toHaveBeenCalledWith();
  expect(mocks.csrf).not.toHaveBeenCalled();
  expect(mocks.headers).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.transition).not.toHaveBeenCalled();
});
