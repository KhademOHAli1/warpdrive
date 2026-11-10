import "./__fixtures__/CaseTransitionActionsTestKit";
import assert from "node:assert/strict";
import { beforeEach, expect, test } from "vitest";
import {
  abortTransition,
  holdTransitionPhase,
  transitionMocks as mocks,
  type NativeTransitionFailure,
  PRIVATE,
  REVIEWER,
  resetTransitionAction,
  type TRANSITION_FAILURES,
  type TransitionValue,
  transitionInput,
  transitionSignal,
} from "./__fixtures__/CaseTransitionActionsTestKit";
import { transitionPrivacyCaseAction as action } from "./reviewerActions";

beforeEach(resetTransitionAction);

for (const phase of ["csrf", "headers", "session", "transition"] as const)
  for (const completion of ["fulfilled", "rejected"] as const)
    test(`the exact original abort wins after pending ${phase} ${completion}`, async () => {
      const hold = holdTransitionPhase(phase, completion);
      const reason = Object.freeze({ syntheticCancelled: PRIVATE, phase, completion });
      const pending = action("csrf", Object.freeze(transitionInput()), REVIEWER);
      const outcome = pending.then(
        (value) => ({ kind: "resolved" as const, value }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
      try {
        const first = await Promise.race([
          hold.entered.then(() => "entered" as const),
          outcome.then(() => "settled" as const),
        ]);
        // The denial scaffold fails immediately here; no stage-wait timeout supplies RED.
        expect(first, "action must reach the selected native boundary").toBe("entered");
        assert(first === "entered");
        abortTransition(reason);
        hold.release();
        const result = await outcome;
        expect(result.kind).toBe("rejected");
        assert(result.kind === "rejected");
        expect(result.error).toBe(reason);
        expect(transitionSignal().reason).toBe(reason);
        expect(mocks[phase]).toHaveBeenCalledTimes(1);
        if (phase !== "transition") expect(mocks.transition).not.toHaveBeenCalled();
        if (phase === "csrf") expect(mocks.headers).not.toHaveBeenCalled();
        if (phase === "headers") expect(mocks.session).not.toHaveBeenCalled();
      } finally {
        hold.release();
        await outcome;
      }
    });

type Failure<Output> =
  Extract<Output, { ok: false }> extends { error: infer Error } ? Error : never;
type Success<Output> = Extract<Output, { ok: true }> extends { value: infer Value } ? Value : never;
type ActionFailure =
  | "invalid_input"
  | "csrf_rejected"
  | "fresh_auth_required"
  | "reviewer_changed"
  | "request_failed";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Condition extends true> = Condition;
type Output = Awaited<ReturnType<typeof action>>;

// Erased compile-only checks: these add no runtime test or PASS. Root owns admitted TSC.
export type CaseTransitionActionContract = [
  Assert<Equal<Success<Output>, TransitionValue>>,
  Assert<Equal<Failure<Output>, ActionFailure | NativeTransitionFailure>>,
  Assert<Equal<(typeof TRANSITION_FAILURES)[number], NativeTransitionFailure>>,
];
