import { beforeEach, describe, expect, test } from "vitest";
import { db } from "@/db/client";
import { err, ok } from "@/types/result";
import {
  expectNoReviewerService,
  reviewerMocks as mocks,
  OTHER_ID,
  PRIVATE,
  REVIEWER_ID,
  resetReviewerBoundary,
  reviewerHeaders,
  reviewerSession,
  reviewerSignal,
  reviewerSubjects,
  SESSION_ID,
} from "./__fixtures__/ReviewerActionsTestKit";

beforeEach(resetReviewerBoundary);

function frozenInput<T extends object>(input: T): Readonly<T> {
  for (const value of Object.values(input))
    if (value !== null && typeof value === "object") frozenInput(value);
  return Object.freeze(input);
}

for (const subject of reviewerSubjects) {
  describe(`${subject.name} reviewer action boundary`, () => {
    test("uses only the fresh native actor and forwards the unchanged service contract", async () => {
      const input = frozenInput(subject.input());
      const original = structuredClone(input);

      const result = await subject.action("csrf", input, REVIEWER_ID);

      expect(result).toEqual(ok(subject.success()));
      expect(mocks.signal).toHaveBeenCalledTimes(1);
      expect(mocks.signal).toHaveBeenCalledWith();
      expect(mocks.csrf).toHaveBeenCalledWith("csrf");
      expect(mocks.headers).toHaveBeenCalledTimes(1);
      expect(mocks.session).toHaveBeenCalledTimes(1);
      expect(mocks.session).toHaveBeenCalledWith(db, reviewerHeaders(), reviewerSignal(), {
        requireFresh: true,
      });
      expect(mocks.session.mock.calls[0]?.[0]).toBe(db);
      expect(subject.service).toHaveBeenCalledTimes(1);
      expect(subject.service).toHaveBeenCalledWith(
        db,
        { userId: REVIEWER_ID, sessionId: SESSION_ID },
        input,
        reviewerSignal(),
      );
      expect(subject.service.mock.calls[0]?.[0]).toBe(db);
      expect(subject.service.mock.calls[0]?.[2]).toBe(input);
      expect(input).toEqual(original);
      expect(mocks.csrf.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.headers.mock.invocationCallOrder[0] ?? 0,
      );
      expect(mocks.headers.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.session.mock.invocationCallOrder[0] ?? 0,
      );
      expect(mocks.session.mock.invocationCallOrder[0]).toBeLessThan(
        subject.service.mock.invocationCallOrder[0] ?? 0,
      );
      expect(structuredClone(result)).toEqual(result);
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE-|metadataEnc|subjectEnc|recipientEnc/);
      expect(JSON.stringify(result)).not.toContain(REVIEWER_ID);
      expect(JSON.stringify(result)).not.toContain(SESSION_ID);
    });

    test("administrator status cannot replace the domain's current capability gate", async () => {
      mocks.session.mockResolvedValueOnce(reviewerSession(REVIEWER_ID, SESSION_ID, true));
      subject.service.mockResolvedValueOnce(err("forbidden"));

      expect(await subject.action("csrf", subject.input(), REVIEWER_ID)).toEqual(err("forbidden"));
      expect(subject.service).toHaveBeenCalledTimes(1);
    });

    test.each([
      { token: null, failure: "missing csrf token" },
      { token: "wrong-token", failure: "origin or csrf mismatch" },
      { token: "csrf", failure: { token: PRIVATE } },
    ])(
      "native CSRF denial precedes headers, session and service lookup: %j",
      async ({ token, failure }) => {
        mocks.csrf.mockResolvedValueOnce(err(failure));

        const result = await subject.action(token, subject.input(), REVIEWER_ID);

        expect(result).toEqual(err("csrf_rejected"));
        expect(mocks.csrf).toHaveBeenCalledTimes(1);
        expect(mocks.csrf).toHaveBeenCalledWith(token);
        expect(mocks.headers).not.toHaveBeenCalled();
        expect(mocks.session).not.toHaveBeenCalled();
        expectNoReviewerService();
        expect(JSON.stringify(result)).not.toContain(PRIVATE);
      },
    );

    test("a missing or stale fresh native session denies before the domain service", async () => {
      mocks.session.mockResolvedValueOnce(null);

      expect(await subject.action("csrf", subject.input(), REVIEWER_ID)).toEqual(
        err("fresh_auth_required"),
      );
      expect(mocks.session).toHaveBeenCalledWith(db, reviewerHeaders(), reviewerSignal(), {
        requireFresh: true,
      });
      expectNoReviewerService();
    });

    test.each([
      { actor: { userId: OTHER_ID, sessionId: OTHER_ID } },
      { userId: OTHER_ID },
      { sessionId: OTHER_ID, isAdmin: true },
    ])("strict input rejection cannot promote client actor metadata %j", async (extra) => {
      const input = frozenInput({ ...subject.input(), ...extra });
      const original = structuredClone(input);
      subject.service.mockResolvedValueOnce(err("invalid_input"));

      expect(await subject.action("csrf", input, REVIEWER_ID)).toEqual(err("invalid_input"));
      expect(subject.service).toHaveBeenCalledWith(
        db,
        { userId: REVIEWER_ID, sessionId: SESSION_ID },
        input,
        reviewerSignal(),
      );
      expect(mocks.session.mock.calls[0]?.[0]).toBe(db);
      expect(subject.service.mock.calls[0]?.[0]).toBe(db);
      expect(subject.service.mock.calls[0]?.[2]).toBe(input);
      expect(input).toEqual(original);
    });

    test.each(["csrf", "headers", "session", "service"] as const)(
      "minimizes unexpected thrown %s errors without exposing private details",
      async (phase) => {
        const target = phase === "service" ? subject.service : mocks[phase];
        target.mockRejectedValueOnce(new Error(PRIVATE));

        const result = await subject.action("csrf", subject.input(), REVIEWER_ID);

        expect(result).toEqual(err("request_failed"));
        expect(JSON.stringify(structuredClone(result))).not.toContain(PRIVATE);
        if (phase !== "service") expectNoReviewerService();
      },
    );

    test.each(["csrf", "headers", "session", "service"] as const)(
      "preserves a %s AbortError even when the shared signal has not aborted",
      async (phase) => {
        const reason = new DOMException("Synthetic reviewer cancellation", "AbortError");
        const target = phase === "service" ? subject.service : mocks[phase];
        target.mockRejectedValueOnce(reason);

        await expect(subject.action("csrf", subject.input(), REVIEWER_ID)).rejects.toBe(reason);
        if (phase !== "service") expectNoReviewerService();
      },
    );

    test.each([PRIVATE, { token: PRIVATE }, "fresh_auth_required"])(
      "unknown service failure stays one bounded result: %j",
      async (failure) => {
        subject.service.mockResolvedValueOnce(err(failure));

        const result = await subject.action("csrf", subject.input(), REVIEWER_ID);

        expect(result).toEqual(err("request_failed"));
        expect(JSON.stringify(result)).not.toContain(PRIVATE);
      },
    );
  });
}

test.each(["invalid_input", "forbidden", "storage_unavailable"] as const)(
  "queue preserves its bounded domain failure %s",
  async (failure) => {
    const subject = reviewerSubjects[0];
    subject.service.mockResolvedValueOnce(err(failure));

    expect(await subject.action("csrf", subject.input(), REVIEWER_ID)).toEqual(err(failure));
  },
);

test.each([
  "invalid_input",
  "forbidden",
  "not_found",
  "idempotency_conflict",
  "storage_unavailable",
  "stale_version",
  "case_assigned",
  "case_not_assignable",
] as const)("claim preserves its bounded domain failure %s", async (failure) => {
  const subject = reviewerSubjects[1];
  subject.service.mockResolvedValueOnce(err(failure));

  expect(await subject.action("csrf", subject.input(), REVIEWER_ID)).toEqual(err(failure));
});

test("a claim receipt is returned unchanged without inventing current queue or assignment state", async () => {
  const subject = reviewerSubjects[1];
  const input = frozenInput(subject.input());
  const original = structuredClone(input);
  const historical = { id: input.caseId, version: 8, status: "verification_needed" };
  subject.service.mockResolvedValueOnce(ok(historical));

  const result = await subject.action("csrf", input, REVIEWER_ID);

  expect(result).toEqual(ok(historical));
  expect(Object.keys(result).sort()).toEqual(["ok", "value"]);
  expect(mocks.list).not.toHaveBeenCalled();
  expect(subject.service).toHaveBeenCalledTimes(1);
  expect(mocks.session.mock.calls[0]?.[0]).toBe(db);
  expect(subject.service.mock.calls[0]?.[0]).toBe(db);
  expect(subject.service.mock.calls[0]?.[2]).toBe(input);
  expect(input).toEqual(original);
});
