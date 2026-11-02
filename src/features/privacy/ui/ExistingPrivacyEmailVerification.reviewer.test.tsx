// @vitest-environment jsdom
import "./__fixtures__/ExistingPrivacyEmailVerificationTestKit";
import "@testing-library/jest-dom/vitest";
import assert from "node:assert/strict";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { err, ok } from "@/types/result";
import {
  CASE,
  CLAIM_RECORDED,
  deferred,
  LATE,
  mocks,
  queue,
  refreshStub,
  resetEmailVerificationUi,
  security,
  USER,
  unverified,
} from "./__fixtures__/ExistingPrivacyEmailVerificationTestKit";
import { ReviewerIntakeCard } from "./ReviewerIntakeCard";

beforeEach(resetEmailVerificationUi);
afterEach(cleanup);
const stale = { ...security, fresh: false };
const unverifiedStale = { ...unverified, fresh: false };
const local = (children: ReactNode) => (
  <LocaleProvider locale="en" timeZone="UTC">
    {children}
  </LocaleProvider>
);
async function press(name: string) {
  await act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
    return Promise.resolve();
  });
}
async function settle<Value>(pending: ReturnType<typeof deferred<Value>>, value: Value) {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
}

test("email loss while props remain stale fences a late queue result through verification recovery", async () => {
  const pending = deferred<Awaited<ReturnType<typeof mocks.list>>>();
  mocks.list.mockReturnValueOnce(pending.promise);
  const refreshSecurity = refreshStub();
  const element = (status = stale) =>
    local(<ReviewerIntakeCard securityStatus={status} refreshSecurity={refreshSecurity} />);
  const view = render(element());
  await press("Load intake queue");
  expect(refreshSecurity).toHaveBeenCalledTimes(1);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(mocks.list).toHaveBeenCalledWith("csrf", { limit: 25 }, USER);
  view.rerender(element(unverifiedStale));
  await settle(pending, ok(queue));
  expect(screen.queryAllByText(CASE)).toHaveLength(0);
  view.rerender(element(security));
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(screen.queryAllByText(CASE)).toHaveLength(0);
  expect(screen.queryByText(CLAIM_RECORDED)).not.toBeInTheDocument();
  await press("Load intake queue");
  expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(screen.getByText(CASE)).toBeInTheDocument();
  expect(mocks.claim).not.toHaveBeenCalled();
});

test("email loss while props remain stale fences a late claim retry and preserves its exact command", async () => {
  const refreshSecurity = refreshStub();
  const element = (status = stale) =>
    local(<ReviewerIntakeCard securityStatus={status} refreshSecurity={refreshSecurity} />);
  const view = render(element());
  await press("Load intake queue");
  expect(mocks.list).toHaveBeenCalledTimes(1);
  view.rerender(element(security));
  expect(screen.getByText(CASE)).toBeInTheDocument();
  mocks.claim.mockResolvedValueOnce(err("request_failed"));
  await press("Take this case");
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  const original = mocks.claim.mock.calls[0]?.[1];
  assert(
    typeof original === "object" &&
      original !== null &&
      "caseId" in original &&
      "expectedVersion" in original,
  );
  expect(original.caseId).toBe(CASE);
  expect(original.expectedVersion).toBe(queue.items[0]?.version);
  expect(Object.isFrozen(original)).toBe(true);
  expect(screen.getByRole("button", { name: "Retry this assignment" })).toBeEnabled();

  view.rerender(element());
  const pending = deferred<Awaited<ReturnType<typeof mocks.claim>>>();
  mocks.claim.mockReturnValueOnce(pending.promise);
  await press("Retry this assignment");
  expect(refreshSecurity).toHaveBeenCalledTimes(3);
  expect(mocks.claim).toHaveBeenCalledTimes(2);
  expect(mocks.claim).toHaveBeenNthCalledWith(2, "csrf", original, USER);
  expect(mocks.claim.mock.calls[1]?.[1]).toBe(original);
  view.rerender(element(unverifiedStale));
  await settle(pending, ok({ id: LATE, version: 99, status: "received" }));
  expect(screen.queryByText(LATE)).not.toBeInTheDocument();
  expect(screen.queryAllByText(CASE)).toHaveLength(0);
  view.rerender(element(security));
  expect(mocks.claim).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(LATE)).not.toBeInTheDocument();
  expect(screen.queryByText(CLAIM_RECORDED)).not.toBeInTheDocument();
  expect(screen.queryAllByText(CASE)).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Retry this assignment" })).toBeEnabled();
  await press("Retry this assignment");
  expect(mocks.claim).toHaveBeenNthCalledWith(3, "csrf", original, USER);
  expect(mocks.claim.mock.calls[2]?.[1]).toBe(original);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(screen.getByText(CLAIM_RECORDED)).toBeInTheDocument();
});
