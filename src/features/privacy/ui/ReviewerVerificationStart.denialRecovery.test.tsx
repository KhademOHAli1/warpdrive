// @vitest-environment jsdom
import "./__fixtures__/ReviewerVerificationStartTestKit";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { err, ok } from "@/types/result";
import {
  CASE,
  deferred,
  labels,
  loadAndClaim,
  mocks,
  mountReviewer,
  press,
  resetVerificationStart,
  security,
  settle,
  transitionReceipt,
  uncertainIntent,
} from "./__fixtures__/ReviewerVerificationStartTestKit";
import { ReviewerIntakeCard } from "./ReviewerIntakeCard";

beforeEach(resetVerificationStart);
afterEach(cleanup);
const assignmentRecorded =
  "Assignment receipt recorded. Refresh the queue to check current availability.";

for (const denial of ["forbidden", "fresh", "email", "unavailable"] as const)
  test(`parent ${denial} denial fences a pending verification result but preserves its exact recovery command`, async () => {
    const subject = mountReviewer((props) => <ReviewerIntakeCard {...props} />);
    await loadAndClaim();
    const pending = deferred<Awaited<ReturnType<typeof mocks.transition>>>();
    mocks.transition.mockReturnValueOnce(pending.promise);
    try {
      await press(labels.en.start);
      expect(mocks.transition).toHaveBeenCalledTimes(1);
      const intent = mocks.transition.mock.calls[0]?.[1];
      expect(Object.isFrozen(intent)).toBe(true);
      expect(intent).toMatchObject({
        caseId: CASE,
        expectedVersion: 8,
        toStatus: "verification_needed",
      });

      if (denial === "forbidden") mocks.list.mockResolvedValueOnce(err("forbidden"));
      else
        subject.refresh.mockResolvedValueOnce(
          denial === "unavailable"
            ? err("unavailable")
            : ok(
                denial === "fresh"
                  ? { ...security, fresh: false }
                  : { ...security, emailVerified: false },
              ),
        );
      await press("Refresh queue");
      expect(mocks.list).toHaveBeenCalledTimes(denial === "forbidden" ? 2 : 1);
      expect(screen.queryAllByText(CASE)).toHaveLength(0);
      expect(screen.queryByText(assignmentRecorded)).not.toBeInTheDocument();
      expect(
        screen.getAllByRole("alert").some((node) => (node.textContent ?? "").trim() !== ""),
      ).toBe(true);

      await settle(pending, ok(transitionReceipt()));
      expect(mocks.transition).toHaveBeenCalledTimes(1);
      expect(screen.queryAllByText(CASE)).toHaveLength(0);
      expect(screen.queryByText(labels.en.recorded)).not.toBeInTheDocument();
      expect(screen.queryByText(assignmentRecorded)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: labels.en.retry })).toBeEnabled();

      const checksBeforeRecovery = subject.refresh.mock.calls.length;
      await press(labels.en.retry);
      expect(subject.refresh).toHaveBeenCalledTimes(checksBeforeRecovery + 1);
      expect(mocks.transition).toHaveBeenCalledTimes(2);
      expect(mocks.transition.mock.calls[1]?.[1]).toBe(intent);
      expect(screen.getByText(labels.en.recorded)).toBeInTheDocument();
      expect(mocks.claim).toHaveBeenCalledTimes(1);
    } finally {
      await settle(pending, ok(transitionReceipt()));
    }
  });

test("an unknown write followed by native forbidden remains retryable with the SAME command after authority recovery", async () => {
  const subject = mountReviewer((props) => <ReviewerIntakeCard {...props} />);
  await loadAndClaim();
  mocks.transition.mockResolvedValueOnce(err("storage_unavailable"));
  const intent = await uncertainIntent();

  mocks.transition.mockResolvedValueOnce(err("forbidden"));
  await press(labels.en.retry);
  expect(mocks.transition).toHaveBeenCalledTimes(2);
  expect(mocks.transition.mock.calls[1]?.[1]).toBe(intent);
  expect(screen.queryAllByText(CASE)).toHaveLength(0);
  expect(screen.queryByText(assignmentRecorded)).not.toBeInTheDocument();
  expect(screen.queryByText(labels.en.recorded)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: labels.en.retry })).toBeEnabled();

  const checksBeforeRecovery = subject.refresh.mock.calls.length;
  await press(labels.en.retry);
  expect(subject.refresh).toHaveBeenCalledTimes(checksBeforeRecovery + 1);
  expect(mocks.transition).toHaveBeenCalledTimes(3);
  expect(mocks.transition.mock.calls[2]?.[1]).toBe(intent);
  expect(intent).toMatchObject({ caseId: CASE, expectedVersion: 8 });
  expect(screen.getByText(labels.en.recorded)).toBeInTheDocument();
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(mocks.claim).toHaveBeenCalledTimes(1);
});
