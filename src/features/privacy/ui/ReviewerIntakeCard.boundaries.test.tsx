// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import assert from "node:assert/strict";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { err, ok } from "@/types/result";
import {
  CASE_ID,
  deferred,
  labels,
  load,
  mocks,
  queue,
  REVIEWER_ID,
  reset,
  row,
  security,
  show,
} from "./ReviewerIntakeTestKit";

beforeEach(reset);
afterEach(cleanup);
const OTHER_CASE = "00000000-0000-4000-8000-000000000042";
const LATE_CASE = "00000000-0000-4000-8000-000000000099";
const recorded = "Assignment receipt recorded. Refresh the queue to check current availability.";

async function recordAssignment() {
  await load();
  fireEvent.click(screen.getByRole("button", { name: labels.en.claim }));
  await screen.findByText(recorded, {}, { timeout: 1000 });
}

test("current permission denial removes a previously recorded assignment receipt", async () => {
  show();
  await recordAssignment();
  mocks.list.mockResolvedValueOnce(err("forbidden"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh queue" }));
  await screen.findByText(
    "These requests are unavailable for your account.",
    {},
    { timeout: 1000 },
  );
  expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
  expect(screen.queryByText(recorded)).not.toBeInTheDocument();
  expect(mocks.claim).toHaveBeenCalledTimes(1);
});

test("fresh-auth denial from the security recheck removes cached receipts before props update", async () => {
  const subject = show();
  await recordAssignment();
  subject.refreshSecurity.mockResolvedValueOnce(ok({ ...security, fresh: false }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh queue" }));
  await screen.findByText(
    "Confirm your identity before loading or assigning requests.",
    {},
    { timeout: 1000 },
  );
  expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
  expect(screen.queryByText(recorded)).not.toBeInTheDocument();
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(mocks.claim).toHaveBeenCalledTimes(1);
});

test("same-account security interruption retains the frozen claim and suppresses its late response", async () => {
  const subject = show();
  await load();
  const late = deferred<{ ok: true; value: { id: string; version: number; status: string } }>();
  mocks.claim.mockReturnValueOnce(late.promise);
  fireEvent.click(screen.getByRole("button", { name: labels.en.claim }));
  await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(1), { timeout: 1000 });
  const original: unknown = mocks.claim.mock.calls[0]?.[1];
  subject.rerender(security, true);
  expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
  subject.rerender(security, false);
  const retry = screen.getByRole("button", { name: "Retry this assignment" });
  await waitFor(() => expect(retry).toBeEnabled(), { timeout: 1000 });
  fireEvent.click(retry);
  await screen.findByText(recorded, {}, { timeout: 1000 });
  expect(mocks.claim.mock.calls[1]).toEqual(["csrf", original, REVIEWER_ID]);
  expect(Object.isFrozen(original)).toBe(true);
  await act(async () => {
    late.resolve(ok({ id: LATE_CASE, version: 99, status: "verification_needed" }));
    await late.promise;
  });
  expect(screen.queryByText(LATE_CASE)).not.toBeInTheDocument();
  expect(mocks.claim).toHaveBeenCalledTimes(2);
});

test("later live pages use the exact cursor and deduplicate to the current case version", async () => {
  mocks.list.mockResolvedValueOnce(ok({ ...queue(), nextAfterId: CASE_ID })).mockResolvedValueOnce(
    ok({
      items: [row(12), { ...row(1), id: OTHER_CASE }],
      nextAfterId: null,
      snapshot: "live_unassigned",
    }),
  );
  mocks.claim.mockResolvedValueOnce(ok({ id: CASE_ID, version: 13, status: "received" }));
  show();
  await load();
  fireEvent.click(screen.getByRole("button", { name: "Load more requests" }));
  await screen.findByText(OTHER_CASE, {}, { timeout: 1000 });
  expect(screen.getAllByText(CASE_ID)).toHaveLength(1);
  expect(mocks.list.mock.calls[1]).toEqual(["csrf", { limit: 25, afterId: CASE_ID }, REVIEWER_ID]);
  const item = screen.getByText(CASE_ID).closest("li");
  assert(item instanceof HTMLElement);
  const take = within(item).getByRole("button", { name: labels.en.claim });
  await waitFor(() => expect(take).toBeEnabled(), { timeout: 1000 });
  fireEvent.click(take);
  await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(1), { timeout: 1000 });
  expect(mocks.claim.mock.calls[0]?.[1]).toMatchObject({ caseId: CASE_ID, expectedVersion: 12 });
});

test("MFA-required status hides cached rows even when a stale fresh flag remains true", async () => {
  const subject = show();
  await load();
  subject.rerender({ ...security, needsMfa: true });
  expect(screen.queryByText(CASE_ID)).not.toBeInTheDocument();
  expect(mocks.claim).not.toHaveBeenCalled();
});
