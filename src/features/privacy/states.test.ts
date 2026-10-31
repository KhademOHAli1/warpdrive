import { expect, test } from "vitest";
import { validateCaseTransition } from "./states";

const cleared = {
  verified: true,
  approvalCurrent: true,
  pendingJobs: 0,
  failedJobs: 0,
  unresolvedObligations: 0,
  responseRecorded: true,
  refusalRecorded: true,
  resultsVerified: true,
};

test("P03A: verification, review, execution and response are independent steps", () => {
  expect(validateCaseTransition("received", "verification_needed", cleared).ok).toBe(true);
  expect(
    validateCaseTransition("verification_needed", "under_review", { ...cleared, verified: false }),
  ).toEqual({ ok: false, error: "verification_required" });
  expect(validateCaseTransition("under_review", "running", cleared)).toEqual({
    ok: false,
    error: "invalid_transition",
  });
  expect(validateCaseTransition("running", "closed", cleared).ok).toBe(false);
  expect(
    validateCaseTransition("response_ready", "responded", { ...cleared, responseRecorded: false })
      .ok,
  ).toBe(false);
  expect(validateCaseTransition("responded", "closed", cleared).ok).toBe(true);
});

test("P03B/C03/C14: partial work and residual obligations cannot become response-ready or closed", () => {
  for (const state of ["response_ready", "closed"] as const) {
    const from = state === "closed" ? "responded" : "running";
    for (const failed of [
      { pendingJobs: 1 },
      { failedJobs: 1 },
      { unresolvedObligations: 1 },
      { resultsVerified: false },
    ])
      expect(validateCaseTransition(from, state, { ...cleared, ...failed }).ok).toBe(false);
  }
  expect(
    validateCaseTransition("under_review", "action_approved", {
      ...cleared,
      approvalCurrent: false,
    }).ok,
  ).toBe(false);
  expect(
    validateCaseTransition("running", "needs_attention", { ...cleared, failedJobs: 1 }).ok,
  ).toBe(true);
});

test("P03B/C13: refusal requires a decision and still needs a recorded response", () => {
  expect(
    validateCaseTransition("under_review", "refused", { ...cleared, refusalRecorded: false }).ok,
  ).toBe(false);
  expect(validateCaseTransition("refused", "closed", cleared).ok).toBe(false);
  expect(validateCaseTransition("refused", "response_ready", cleared).ok).toBe(true);
});
