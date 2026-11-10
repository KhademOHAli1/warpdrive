// @vitest-environment jsdom
import "./__fixtures__/ReviewerVerificationStartTestKit";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import { err, ok, type Result } from "@/types/result";
import {
  CASE,
  deferred,
  labels,
  loadAndClaim,
  losses,
  mocks,
  mountReviewer,
  OTHER,
  OTHER_CASE,
  PRIVATE,
  press,
  queue,
  resetVerificationStart,
  security,
  settle,
  transitionReceipt,
  uncertainIntent,
} from "./__fixtures__/ReviewerVerificationStartTestKit";
import { ReviewerIntakeCard } from "./ReviewerIntakeCard";

beforeEach(resetVerificationStart);
afterEach(cleanup);
const mount = (status = security) =>
  mountReviewer((props) => <ReviewerIntakeCard {...props} />, { status });
async function prepareUnknown() {
  await loadAndClaim();
  mocks.transition.mockResolvedValueOnce(err("storage_unavailable"));
  return uncertainIntent();
}

for (const loss of losses)
  test(`a fresh ${loss.name} recheck denial cannot retry a sent command and preserves it for explicit recovery`, async () => {
    const subject = mount();
    const intent = await prepareUnknown();
    subject.refresh.mockResolvedValueOnce(loss.unavailable ? err("unavailable") : ok(loss.status));
    await press(labels.en.retry);
    expect(mocks.transition).toHaveBeenCalledTimes(1);
    expect(
      screen.getAllByRole("alert").some((node) => (node.textContent ?? "").trim() !== ""),
    ).toBe(true);
    expect(screen.queryByText(labels.en.recorded)).not.toBeInTheDocument();
    await press(labels.en.retry);
    expect(mocks.transition).toHaveBeenCalledTimes(2);
    expect(mocks.transition.mock.calls[1]?.[1]).toBe(intent);
    expect(screen.getByText(labels.en.recorded)).toBeInTheDocument();
  });

for (const loss of losses)
  for (const boundary of ["security", "transition"] as const)
    test(`${loss.name} props loss while ${boundary} is pending hides caches, fences late success and keeps the exact command`, async () => {
      const subject = mount();
      const intent = await prepareUnknown();
      const recheck = deferred<Awaited<ReturnType<typeof subject.refresh>>>();
      const response = deferred<Awaited<ReturnType<typeof mocks.transition>>>();
      if (boundary === "security") subject.refresh.mockReturnValueOnce(recheck.promise);
      else mocks.transition.mockReturnValueOnce(response.promise);
      try {
        await press(labels.en.retry);
        const sent = boundary === "security" ? 1 : 2;
        expect(mocks.transition).toHaveBeenCalledTimes(sent);
        subject.rerender(loss.status, loss.unavailable);
        expect(screen.queryAllByText(CASE)).toHaveLength(0);
        if (boundary === "security") await settle(recheck, ok(security));
        else await settle(response, ok(transitionReceipt()));
        expect(mocks.transition).toHaveBeenCalledTimes(sent);
        expect(screen.queryByText(labels.en.recorded)).not.toBeInTheDocument();
        subject.rerender(security);
        expect(screen.queryByText(labels.en.recorded)).not.toBeInTheDocument();
        expect(screen.queryAllByText(CASE)).toHaveLength(0);
        await press(labels.en.retry);
        expect(mocks.transition).toHaveBeenCalledTimes(sent + 1);
        expect(mocks.transition.mock.calls[sent]?.[1]).toBe(intent);
        expect(screen.getByText(labels.en.recorded)).toBeInTheDocument();
        expect(mocks.list).toHaveBeenCalledTimes(1);
        expect(mocks.claim).toHaveBeenCalledTimes(1);
      } finally {
        await settle(recheck, ok(security));
        await settle(response, ok(transitionReceipt()));
      }
    });

for (const denial of ["account", "signout", "forbidden", "fresh", "email"] as const)
  test(`transition-side ${denial} clears parent rows/claim receipt and fences an already-started queue response`, async () => {
    const subject = mount();
    await loadAndClaim();
    // Prove the new control exists before starting an independently pending parent read.
    expect(screen.getByRole("button", { name: labels.en.start })).toBeEnabled();
    const pending = deferred<Awaited<ReturnType<typeof mocks.list>>>();
    mocks.list.mockReturnValueOnce(pending.promise);
    try {
      await press("Refresh queue");
      expect(mocks.list).toHaveBeenCalledTimes(2);
      if (denial === "forbidden") mocks.transition.mockResolvedValueOnce(err("forbidden"));
      else
        subject.refresh.mockResolvedValueOnce(
          ok(
            denial === "signout"
              ? null
              : denial === "account"
                ? { ...security, user: { ...security.user, id: OTHER } }
                : denial === "fresh"
                  ? { ...security, fresh: false }
                  : { ...security, emailVerified: false },
          ),
        );
      await press(labels.en.start);
      expect(mocks.transition).toHaveBeenCalledTimes(denial === "forbidden" ? 1 : 0);
      expect(screen.queryAllByText(CASE)).toHaveLength(0);
      expect(
        screen.queryByText(
          "Assignment receipt recorded. Refresh the queue to check current availability.",
        ),
      ).not.toBeInTheDocument();
      await settle(pending, ok(queue()));
      expect(screen.queryAllByText(CASE)).toHaveLength(0);
      expect(screen.queryByText(labels.en.recorded)).not.toBeInTheDocument();
      expect(mocks.claim).toHaveBeenCalledTimes(1);
      if (denial === "account" || denial === "signout") {
        subject.rerender(security);
        expect(screen.queryByRole("button", { name: labels.en.retry })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Load intake queue" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Refresh queue" })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Reload privacy settings" })).toHaveAttribute(
          "href",
          "/settings/privacy",
        );
      }
    } finally {
      await settle(pending, ok(queue()));
    }
  });

test("an account props switch during the transition blocks the parent and a late valid receipt cannot restore it", async () => {
  const subject = mount();
  await loadAndClaim();
  const pending = deferred<Awaited<ReturnType<typeof mocks.transition>>>();
  mocks.transition.mockReturnValueOnce(pending.promise);
  try {
    await press(labels.en.start);
    expect(mocks.transition).toHaveBeenCalledTimes(1);
    subject.rerender({ ...security, user: { ...security.user, id: OTHER } });
    expect(screen.queryAllByText(CASE)).toHaveLength(0);
    await settle(pending, ok(transitionReceipt()));
    subject.rerender(security);
    expect(screen.queryByText(labels.en.recorded)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: labels.en.retry })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Your signed-in account changed.");
    expect(mocks.transition).toHaveBeenCalledTimes(1);
  } finally {
    await settle(pending, ok(transitionReceipt()));
  }
});

test.each(["transport", "abort"] as const)(
  "a security %s exception preserves the already sent intent",
  async (kind) => {
    const subject = mount();
    const intent = await prepareUnknown();
    subject.refresh.mockRejectedValueOnce(
      kind === "abort" ? new DOMException(PRIVATE, "AbortError") : new Error(PRIVATE),
    );
    await press(labels.en.retry);
    expect(mocks.transition).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(PRIVATE);
    expect(screen.getByRole("button", { name: labels.en.retry })).toBeEnabled();
    await press(labels.en.retry);
    expect(mocks.transition).toHaveBeenCalledTimes(2);
    expect(mocks.transition.mock.calls[1]?.[1]).toBe(intent);
  },
);

for (const factor of ["emailVerified", "needsMfa", "needsEnrollment"] as const)
  for (const boundary of ["security", "transition"] as const)
    test(`first stale epoch and a new fresh callback cannot survive later ${factor} loss during ${boundary}`, async () => {
      const stale = { ...security, fresh: false };
      const subject = mount(stale);
      await press("Load intake queue");
      expect(mocks.list).toHaveBeenCalledTimes(1);
      subject.rerender(security);
      await press("Take this case");
      mocks.transition.mockResolvedValueOnce(err("storage_unavailable"));
      const intent = await uncertainIntent();
      const replacement = vi
        .fn<(signal: AbortSignal) => Promise<Result<SecurityStatus | null, "unavailable">>>()
        .mockResolvedValue(ok(security));
      const recheck = deferred<Awaited<ReturnType<typeof replacement>>>();
      const response = deferred<Awaited<ReturnType<typeof mocks.transition>>>();
      if (boundary === "security") replacement.mockReturnValueOnce(recheck.promise);
      else mocks.transition.mockReturnValueOnce(response.promise);
      subject.rerender(stale, false, replacement);
      try {
        await press(labels.en.retry);
        expect(replacement).toHaveBeenCalledTimes(1);
        const sent = boundary === "security" ? 1 : 2;
        expect(mocks.transition).toHaveBeenCalledTimes(sent);
        subject.rerender({ ...stale, [factor]: factor !== "emailVerified" }, false, replacement);
        if (boundary === "security") await settle(recheck, ok(security));
        else await settle(response, ok(transitionReceipt()));
        expect(mocks.transition).toHaveBeenCalledTimes(sent);
        expect(screen.queryByText(labels.en.recorded)).not.toBeInTheDocument();
        expect(screen.queryAllByText(CASE)).toHaveLength(0);
        subject.rerender(security, false, replacement);
        await press(labels.en.retry);
        expect(mocks.transition).toHaveBeenCalledTimes(sent + 1);
        expect(mocks.transition.mock.calls[sent]?.[1]).toBe(intent);
        expect(screen.getByText(labels.en.recorded)).toBeInTheDocument();
      } finally {
        await settle(recheck, ok(security));
        await settle(response, ok(transitionReceipt()));
      }
    });

test("an unresolved transition locks new claims and retargeting even after a live queue refresh", async () => {
  mount();
  const intent = await prepareUnknown();
  mocks.list.mockResolvedValueOnce(
    ok({ ...queue(), items: [...queue(30).items, ...queue(1, "received", OTHER_CASE).items] }),
  );
  await press("Refresh queue");
  const claims = screen.getAllByRole("button", { name: "Take this case" });
  for (const button of claims) {
    expect(button).toBeDisabled();
    fireEvent.click(button);
  }
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  expect(mocks.transition).toHaveBeenCalledTimes(1);
  await press(labels.en.retry);
  expect(mocks.transition.mock.calls[1]?.[1]).toBe(intent);
  expect(intent).toMatchObject({ caseId: CASE, expectedVersion: 8 });
});

test("unmount aborts the active security scope and suppresses a late valid transition receipt", async () => {
  const subject = mount();
  await loadAndClaim();
  const pending = deferred<Awaited<ReturnType<typeof mocks.transition>>>();
  mocks.transition.mockReturnValueOnce(pending.promise);
  try {
    await press(labels.en.start);
    expect(mocks.transition).toHaveBeenCalledTimes(1);
    const signal = subject.refresh.mock.calls[2]?.[0];
    expect(signal).toBeInstanceOf(AbortSignal);
    subject.view.unmount();
    expect(signal?.aborted).toBe(true);
    await settle(pending, ok(transitionReceipt()));
    expect(screen.queryByText(labels.en.recorded)).not.toBeInTheDocument();
    expect(mocks.transition).toHaveBeenCalledTimes(1);
  } finally {
    await settle(pending, ok(transitionReceipt()));
  }
});
