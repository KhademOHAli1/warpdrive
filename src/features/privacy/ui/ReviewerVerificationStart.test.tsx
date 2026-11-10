// @vitest-environment jsdom
import "./__fixtures__/ReviewerVerificationStartTestKit";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { err, ok } from "@/types/result";
import {
  CASE,
  claimReceipt,
  deferred,
  labels,
  loadAndClaim,
  mocks,
  mountReviewer,
  OTHER_CASE,
  PRIVATE,
  press,
  queue,
  resetVerificationStart,
  security,
  settle,
  transitionReceipt,
  USER,
  uncertainIntent,
} from "./__fixtures__/ReviewerVerificationStartTestKit";
import { ReviewerIntakeCard } from "./ReviewerIntakeCard";

beforeEach(resetVerificationStart);
afterEach(cleanup);
const mount = () => mountReviewer((props) => <ReviewerIntakeCard {...props} />);

test("load then claim a received request, then explicitly start one freshly checked verification command", async () => {
  const subject = mount();
  expect(mocks.transition).not.toHaveBeenCalled();
  await loadAndClaim();
  expect(screen.getByText(labels.en.warning)).toBeInTheDocument();
  expect(mocks.transition).not.toHaveBeenCalled();
  await press(labels.en.start);
  expect(subject.refresh).toHaveBeenCalledTimes(3);
  expect(mocks.transition).toHaveBeenCalledTimes(1);
  const intent = mocks.transition.mock.calls[0]?.[1];
  expect(intent).toEqual({
    caseId: CASE,
    expectedVersion: 8,
    commandId: expect.stringMatching(
      /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/iu,
    ),
    toStatus: "verification_needed",
  });
  expect(Object.isFrozen(intent)).toBe(true);
  expect(mocks.transition).toHaveBeenCalledWith("csrf", intent, USER);
  expect(screen.getByText(labels.en.recorded)).toBeInTheDocument();
  expect(screen.getByText(labels.en.historical)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: labels.en.start })).not.toBeInTheDocument();
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toMatch(
    /message sent|identity confirmed|verification completed/iu,
  );
});

test("a queued row without a recorded assignment is not a verification candidate", async () => {
  mount();
  await press("Load intake queue");
  expect(screen.getByText(CASE)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: labels.en.start })).not.toBeInTheDocument();
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.transition).not.toHaveBeenCalled();
});

test.each(["verification_needed", "under_review", "cancelled"])(
  "current non-received state %s cannot start this first verification step",
  async (status) => {
    mocks.list.mockResolvedValueOnce(ok(queue(7, status)));
    mocks.claim.mockResolvedValueOnce(ok(claimReceipt({ status })));
    mount();
    await press("Load intake queue");
    if (status === "verification_needed") await press("Take this case");
    else expect(screen.getByRole("button", { name: "Take this case" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: labels.en.start })).not.toBeInTheDocument();
    expect(mocks.transition).not.toHaveBeenCalled();
  },
);

test.each([{ id: OTHER_CASE }, { version: 99 }])(
  "a mismatched assignment receipt %j cannot create a transition target",
  async (patch) => {
    mocks.claim.mockResolvedValueOnce(ok(claimReceipt(patch)));
    mount();
    await loadAndClaim();
    expect(screen.queryByRole("button", { name: labels.en.start })).not.toBeInTheDocument();
    expect(mocks.transition).not.toHaveBeenCalled();
  },
);

test("rapid repeated starts cannot create a second command while the first response is pending", async () => {
  mount();
  await loadAndClaim();
  const pending = deferred<Awaited<ReturnType<typeof mocks.transition>>>();
  mocks.transition.mockReturnValueOnce(pending.promise);
  const button = screen.getByRole("button", { name: labels.en.start });
  await act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
    return Promise.resolve();
  });
  expect(mocks.transition).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  await settle(pending, ok(transitionReceipt()));
  expect(screen.getByText(labels.en.recorded)).toBeInTheDocument();
  expect(mocks.transition).toHaveBeenCalledTimes(1);
});

for (const failure of [
  "storage_unavailable",
  "request_failed",
  "unknown string",
  "unknown object",
  "transport",
  "abort",
] as const)
  test(`${failure} preserves the SAME frozen retry beyond queue refresh and same-user cache loss`, async () => {
    const subject = mount();
    await loadAndClaim();
    if (failure === "transport" || failure === "abort")
      mocks.transition.mockRejectedValueOnce(
        failure === "abort" ? new DOMException(PRIVATE, "AbortError") : new Error(PRIVATE),
      );
    else
      mocks.transition.mockResolvedValueOnce(
        err(
          failure === "unknown string"
            ? PRIVATE
            : failure === "unknown object"
              ? { privatePayload: PRIVATE }
              : failure,
        ),
      );
    const intent = await uncertainIntent();
    expect(screen.getByText(labels.en.uncertain)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(PRIVATE);
    mocks.list.mockResolvedValueOnce(ok(queue(19)));
    await press("Refresh queue");
    subject.rerender(security, true);
    subject.rerender(security, false);
    expect(mocks.transition).toHaveBeenCalledTimes(1);
    await press(labels.en.retry);
    expect(mocks.transition).toHaveBeenCalledTimes(2);
    expect(mocks.transition.mock.calls[1]?.[1]).toBe(intent);
    expect(intent).toMatchObject({
      caseId: CASE,
      expectedVersion: 8,
      toStatus: "verification_needed",
    });
    expect(screen.getByText(labels.en.recorded)).toBeInTheDocument();
  });

test.each([
  "stale_version",
  "forbidden",
  "invalid_input",
  "idempotency_conflict",
  "invalid_transition",
  "verification_required",
  "approval_required",
  "work_unresolved",
  "response_required",
  "decision_required",
] as const)(
  "native %s denial displays bounded feedback without an automatic read or second transition",
  async (failure) => {
    mount();
    await loadAndClaim();
    mocks.transition.mockResolvedValueOnce(err(failure));
    await press(labels.en.start);
    expect(mocks.transition).toHaveBeenCalledTimes(1);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((alert) => (alert.textContent ?? "").trim().length > 0)).toBe(true);
    expect(alerts.map((alert) => alert.textContent).join(" ")).not.toContain(failure);
    if (failure === "stale_version") expect(screen.getByText(labels.en.stale)).toBeInTheDocument();
    expect(screen.queryByText(labels.en.recorded)).not.toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  },
);

test.each([{ id: OTHER_CASE }, { status: "received" }, { version: 99 }])(
  "an unbound transition receipt %j remains unresolved and cannot publish success",
  async (patch) => {
    mount();
    await loadAndClaim();
    mocks.transition.mockResolvedValueOnce(ok(transitionReceipt(patch)));
    const intent = await uncertainIntent();
    expect(screen.queryByText(labels.en.recorded)).not.toBeInTheDocument();
    expect(screen.queryByText(OTHER_CASE)).not.toBeInTheDocument();
    await press(labels.en.retry);
    expect(mocks.transition.mock.calls[1]?.[1]).toBe(intent);
    expect(screen.getByText(labels.en.recorded)).toBeInTheDocument();
  },
);

test("clearing saved retry is explicitly local and neither undoes nor automatically repeats a mutation", async () => {
  mount();
  await loadAndClaim();
  mocks.transition.mockResolvedValueOnce(err("storage_unavailable"));
  await uncertainIntent();
  expect(screen.getByText(labels.en.clearHelp)).toBeInTheDocument();
  await press(labels.en.clear);
  expect(screen.queryByRole("button", { name: labels.en.retry })).not.toBeInTheDocument();
  expect(screen.queryByText(labels.en.recorded)).not.toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(
    /status restored|change undone|verification cancelled/iu,
  );
  expect(mocks.transition).toHaveBeenCalledTimes(1);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(mocks.claim).toHaveBeenCalledTimes(1);
});
