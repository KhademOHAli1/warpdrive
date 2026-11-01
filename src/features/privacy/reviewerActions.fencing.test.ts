import { beforeEach, describe, expect, test } from "vitest";
import { db } from "@/db/client";
import { err, ok } from "@/types/result";
import {
  abortReviewerRequest,
  expectNoReviewerService,
  reviewerMocks as mocks,
  OTHER_ID,
  OTHER_SESSION_ID,
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

for (const subject of reviewerSubjects) {
  describe(`${subject.name} reviewer selector and cancellation`, () => {
    test.each([
      { label: "missing", expected: undefined },
      { label: "null", expected: null },
      { label: "empty", expected: "" },
      { label: "not a UUID", expected: PRIVATE },
      { label: "number", expected: 42 },
      { label: "object", expected: { userId: REVIEWER_ID } },
      { label: "array", expected: [REVIEWER_ID] },
    ])("rejects a $label reviewer selector before native lookup", async ({ expected }) => {
      const result = await subject.action("csrf", subject.input(), expected);

      expect(result).toEqual(err("invalid_input"));
      expect(mocks.csrf).toHaveBeenCalledTimes(1);
      expect(mocks.headers).not.toHaveBeenCalled();
      expect(mocks.session).not.toHaveBeenCalled();
      expectNoReviewerService();
      expect(JSON.stringify(result)).not.toContain(PRIVATE);
    });

    test.each([
      { label: "native account changed", native: OTHER_ID, expected: REVIEWER_ID },
      { label: "forged reviewer selector", native: REVIEWER_ID, expected: OTHER_ID },
    ])("denies $label rather than deriving authority from the selector", async (value) => {
      mocks.session.mockResolvedValueOnce(reviewerSession(value.native));

      const result = await subject.action("csrf", subject.input(), value.expected);

      expect(result).toEqual(err("reviewer_changed"));
      expect(mocks.session).toHaveBeenCalledWith(db, reviewerHeaders(), reviewerSignal(), {
        requireFresh: true,
      });
      expectNoReviewerService();
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE-|00000000-/);
    });

    test("CSRF denial precedes even a malformed reviewer selector", async () => {
      mocks.csrf.mockResolvedValueOnce(err(PRIVATE));

      const result = await subject.action(null, subject.input(), { userId: PRIVATE });

      expect(result).toEqual(err("csrf_rejected"));
      expect(mocks.headers).not.toHaveBeenCalled();
      expect(mocks.session).not.toHaveBeenCalled();
      expectNoReviewerService();
    });

    test("a matching selector never substitutes the native session identity", async () => {
      mocks.session.mockResolvedValueOnce(reviewerSession(REVIEWER_ID, OTHER_SESSION_ID));
      const input = Object.freeze(subject.input());
      const original = structuredClone(input);

      expect(await subject.action("csrf", input, REVIEWER_ID)).toEqual(ok(subject.success()));
      expect(subject.service).toHaveBeenCalledWith(
        db,
        { userId: REVIEWER_ID, sessionId: OTHER_SESSION_ID },
        input,
        reviewerSignal(),
      );
      expect(mocks.session.mock.calls[0]?.[0]).toBe(db);
      expect(subject.service.mock.calls[0]?.[0]).toBe(db);
      expect(subject.service.mock.calls[0]?.[2]).toBe(input);
      expect(input).toEqual(original);
    });

    test("an administrator still cannot bypass the deny-only account fence", async () => {
      mocks.session.mockResolvedValueOnce(reviewerSession(REVIEWER_ID, SESSION_ID, true));

      expect(await subject.action("csrf", subject.input(), OTHER_ID)).toEqual(
        err("reviewer_changed"),
      );
      expectNoReviewerService();
    });

    test("an already-aborted required signal rejects before boundary I/O", async () => {
      const reason = new DOMException("Synthetic pre-aborted reviewer request", "AbortError");
      abortReviewerRequest(reason);

      await expect(subject.action("csrf", subject.input(), REVIEWER_ID)).rejects.toBe(reason);
      expect(mocks.signal).toHaveBeenCalledTimes(1);
      expect(mocks.csrf).not.toHaveBeenCalled();
      expect(mocks.headers).not.toHaveBeenCalled();
      expect(mocks.session).not.toHaveBeenCalled();
      expectNoReviewerService();
    });

    test("a frozen arbitrary pre-abort reason is preserved before boundary I/O", async () => {
      const reason = Object.freeze({ requestCancelled: PRIVATE });
      abortReviewerRequest(reason);

      await expect(
        subject.action("csrf", Object.freeze(subject.input()), REVIEWER_ID),
      ).rejects.toBe(reason);
      expect(mocks.signal).toHaveBeenCalledTimes(1);
      expect(mocks.csrf).not.toHaveBeenCalled();
      expect(mocks.headers).not.toHaveBeenCalled();
      expect(mocks.session).not.toHaveBeenCalled();
      expectNoReviewerService();
    });

    test.each(["csrf", "headers", "session", "service"] as const)(
      "propagates the shared abort after awaited %s I/O",
      async (phase) => {
        const reason = new DOMException("Synthetic in-flight reviewer cancellation", "AbortError");
        if (phase === "csrf")
          mocks.csrf.mockImplementationOnce(() => {
            abortReviewerRequest(reason);
            return Promise.resolve(ok(true));
          });
        if (phase === "headers")
          mocks.headers.mockImplementationOnce(() => {
            abortReviewerRequest(reason);
            return Promise.resolve(reviewerHeaders());
          });
        if (phase === "session")
          mocks.session.mockImplementationOnce(() => {
            abortReviewerRequest(reason);
            return Promise.resolve(reviewerSession());
          });
        if (phase === "service")
          subject.service.mockImplementationOnce(() => {
            abortReviewerRequest(reason);
            return Promise.resolve(ok(subject.success()));
          });

        await expect(subject.action("csrf", subject.input(), REVIEWER_ID)).rejects.toBe(reason);
        expect(mocks.signal).toHaveBeenCalledTimes(1);
        if (phase === "csrf") {
          expect(mocks.headers).not.toHaveBeenCalled();
          expect(mocks.session).not.toHaveBeenCalled();
        }
        if (phase === "headers") expect(mocks.session).not.toHaveBeenCalled();
        if (phase !== "service") expectNoReviewerService();
      },
    );

    test.each(["csrf", "session", "service"] as const)(
      "an abort still wins when awaited %s I/O returns a denial",
      async (phase) => {
        const reason = new DOMException("Synthetic denied reviewer cancellation", "AbortError");
        if (phase === "csrf")
          mocks.csrf.mockImplementationOnce(() => {
            abortReviewerRequest(reason);
            return Promise.resolve(err(PRIVATE));
          });
        if (phase === "session")
          mocks.session.mockImplementationOnce(() => {
            abortReviewerRequest(reason);
            return Promise.resolve(null);
          });
        if (phase === "service")
          subject.service.mockImplementationOnce(() => {
            abortReviewerRequest(reason);
            return Promise.resolve(err("storage_unavailable"));
          });

        await expect(subject.action("csrf", subject.input(), REVIEWER_ID)).rejects.toBe(reason);
        if (phase !== "service") expectNoReviewerService();
      },
    );

    test.each(["csrf", "headers", "session", "service"] as const)(
      "the shared abort reason wins over an ordinary %s exception",
      async (phase) => {
        const reason = new DOMException("Synthetic failed reviewer cancellation", "AbortError");
        const target = phase === "service" ? subject.service : mocks[phase];
        target.mockImplementationOnce(() => {
          abortReviewerRequest(reason);
          return Promise.reject(new Error(PRIVATE));
        });

        await expect(subject.action("csrf", subject.input(), REVIEWER_ID)).rejects.toBe(reason);
        if (phase !== "service") expectNoReviewerService();
      },
    );

    test.each(["csrf", "headers", "session", "service"] as const)(
      "a frozen arbitrary abort reason wins over an ordinary %s exception",
      async (phase) => {
        const reason = Object.freeze({ requestCancelled: PRIVATE });
        const target = phase === "service" ? subject.service : mocks[phase];
        target.mockImplementationOnce(() => {
          abortReviewerRequest(reason);
          return Promise.reject(new Error(PRIVATE));
        });

        await expect(
          subject.action("csrf", Object.freeze(subject.input()), REVIEWER_ID),
        ).rejects.toBe(reason);
        expect(mocks.signal).toHaveBeenCalledTimes(1);
        if (phase === "csrf") {
          expect(mocks.headers).not.toHaveBeenCalled();
          expect(mocks.session).not.toHaveBeenCalled();
        }
        if (phase === "headers") expect(mocks.session).not.toHaveBeenCalled();
        if (phase !== "service") expectNoReviewerService();
      },
    );
  });
}
