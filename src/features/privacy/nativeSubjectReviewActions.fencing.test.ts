import assert from "node:assert/strict";
import { beforeEach, expect, test } from "vitest";
import {
  abortAction,
  actionInput,
  actionSignal,
  deferred,
  fulfilledPhase,
  actionMocks as mocks,
  PRIVATE,
  REVIEWER,
  resetNativeReviewAction,
} from "./nativeSubjectReviewActionsTestKit";
import { loadPrivacyNativeSubjectReviewAction as action } from "./reviewerActions";

beforeEach(resetNativeReviewAction);

test("a pre-aborted bounded action signal preserves its exact non-Error reason before any I/O", async () => {
  const reason = Object.freeze({ code: "SYNTHETIC-NATIVE-ACTION-ABORT" });
  abortAction(reason);
  await expect(action("csrf", actionInput(), REVIEWER)).rejects.toBe(reason);
  expect(mocks.signal).toHaveBeenCalledTimes(1);
  expect(mocks.csrf).not.toHaveBeenCalled();
  expect(mocks.headers).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.load).not.toHaveBeenCalled();
});

for (const phase of ["csrf", "headers", "session", "load"] as const)
  for (const completion of ["fulfilled", "rejected"] as const)
    test(`late ${phase} ${completion} cannot replace the original pending-request abort reason`, async () => {
      const entered = deferred<void>();
      const finish = deferred<void>();
      const reason = Object.freeze({ code: "SYNTHETIC-LATE-ACTION-ABORT", phase, completion });
      mocks[phase].mockImplementationOnce(async () => {
        entered.resolve();
        await finish.promise;
        if (completion === "rejected") throw new Error(PRIVATE);
        return fulfilledPhase(phase);
      });
      const pending = action("csrf", actionInput(), REVIEWER);
      const outcome = pending.then(
        (value) => ({ kind: "resolved" as const, value }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
      try {
        const first = await Promise.race([
          entered.promise.then(() => "entered" as const),
          outcome.then(() => "settled" as const),
        ]);
        // The denial scaffold fails here immediately; no mocked-stage observation timeout.
        expect(first, "action must reach its native boundary before completing").toBe("entered");
        assert(first === "entered");
        abortAction(reason);
        finish.resolve();
        const result = await outcome;
        expect(result.kind).toBe("rejected");
        assert(result.kind === "rejected");
        expect(result.error).toBe(reason);
        expect(actionSignal().reason).toBe(reason);
        if (phase !== "load") expect(mocks.load).not.toHaveBeenCalled();
        if (phase === "csrf") expect(mocks.headers).not.toHaveBeenCalled();
        if (phase === "headers") expect(mocks.session).not.toHaveBeenCalled();
      } finally {
        finish.resolve();
        await outcome;
      }
    });
